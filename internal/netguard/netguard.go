// Package netguard blocks outbound connections to internal address space.
//
// Validating a hostname and then handing that same hostname to a dialer
// resolves it twice, and an attacker who controls the DNS record can answer
// differently the second time — the classic time-of-check/time-of-use gap.
// The setup connectivity tests had exactly that shape; webhook.Dispatcher had
// already solved it by pinning the dial to a validated address. This package
// is that solution, factored out so every outbound path shares one blocklist
// and one dialer.
package netguard

import (
	"context"
	"fmt"
	"net"
	"time"
)

// blockedRanges are address ranges no user-supplied target may reach.
var blockedRanges = func() []*net.IPNet {
	cidrs := []string{
		"10.0.0.0/8",     // RFC1918
		"172.16.0.0/12",  // RFC1918
		"192.168.0.0/16", // RFC1918
		"127.0.0.0/8",    // loopback
		"169.254.0.0/16", // link-local, including the 169.254.169.254 metadata service
		"100.64.0.0/10",  // RFC6598 carrier-grade NAT
		"192.0.0.0/24",   // IETF protocol assignments
		"198.18.0.0/15",  // RFC2544 benchmarking
		"::1/128",        // IPv6 loopback
		"fc00::/7",       // IPv6 unique-local
		"fe80::/10",      // IPv6 link-local
	}
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		if _, n, err := net.ParseCIDR(c); err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}()

// IsBlocked reports whether an address is inside internal space. It also
// catches the unspecified address: connecting to 0.0.0.0 reaches localhost on
// Linux, so a hostname rebound to it would otherwise slip through.
func IsBlocked(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	// Compare in the address's natural family so an IPv4-mapped IPv6 address
	// is measured against the IPv4 ranges.
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, n := range blockedRanges {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ErrBlocked is returned when a target resolves into internal address space.
type ErrBlocked struct {
	Host string
	IP   string
}

func (e *ErrBlocked) Error() string {
	if e.IP == "" {
		return fmt.Sprintf("%s resolves to a private or internal address", e.Host)
	}
	return fmt.Sprintf("%s resolves to %s, a private or internal address", e.Host, e.IP)
}

// ResolveSafe resolves a hostname and returns the addresses only if every one
// of them is outside internal space. Requiring all of them, not just the one
// we dial, means a record that mixes a public and a private answer is
// rejected rather than raced.
//
// An input that is already an IP literal is checked and returned as-is.
func ResolveSafe(ctx context.Context, host string) ([]net.IP, error) {
	if literal := net.ParseIP(host); literal != nil {
		if IsBlocked(literal) {
			return nil, &ErrBlocked{Host: host, IP: literal.String()}
		}
		return []net.IP{literal}, nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve %s", host)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("no addresses for %s", host)
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		if IsBlocked(a.IP) {
			return nil, &ErrBlocked{Host: host, IP: a.IP.String()}
		}
		ips = append(ips, a.IP)
	}
	return ips, nil
}

// DialContext returns a dial function that resolves the target, rejects it if
// any answer is internal, and then connects to the validated address literal.
// Because the literal is what reaches the kernel, a second DNS answer cannot
// redirect the connection.
func DialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: timeout}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := ResolveSafe(ctx, host)
		if err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
}

// Dial connects to host:port through the same validation, for callers that
// are not driving an http.Transport.
func Dial(ctx context.Context, host string, port int, timeout time.Duration) (net.Conn, error) {
	ips, err := ResolveSafe(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: timeout}
	return dialer.DialContext(ctx, "tcp", net.JoinHostPort(ips[0].String(), fmt.Sprint(port)))
}
