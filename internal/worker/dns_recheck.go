package worker

import (
	"context"
	"log/slog"

	"gitlab.com/burnerbyte/burnerbyte/internal/dns"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

func DNSRecheckJob(domainRepo *postgres.DomainRepo, expectedMXHost string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		domains, err := domainRepo.ListAll(ctx)
		if err != nil {
			return err
		}
		checked := 0
		for _, d := range domains {
			mx, _ := dns.VerifyMX(d.DomainName, expectedMXHost)
			txt, _ := dns.VerifyTXT(d.DomainName, dns.GenerateVerificationRecord(d.ID.String()))
			if mx != d.MXVerified || txt != d.TXTVerified {
				if err := domainRepo.UpdateDNSStatus(ctx, d.ID, mx, txt); err != nil {
					slog.Error("dns recheck update failed", "domain", d.DomainName, "error", err)
					continue
				}
				slog.Info("dns status changed", "domain", d.DomainName, "mx", mx, "txt", txt)
			}
			checked++
		}
		if checked > 0 {
			slog.Debug("dns recheck completed", "checked", checked)
		}
		return nil
	}
}
