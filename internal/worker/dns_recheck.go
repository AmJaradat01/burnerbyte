package worker

import (
	"context"
	"log/slog"

	"gitlab.com/burnerbyte/burnerbyte/internal/dns"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

const dnsBatchSize = 100

func DNSRecheckJob(domainRepo *postgres.DomainRepo, expectedMXHost string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		checked := 0
		page := 1
		for {
			domains, _, err := domainRepo.ListByPage(ctx, page, dnsBatchSize)
			if err != nil {
				return err
			}
			if len(domains) == 0 {
				break
			}
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
			if len(domains) < dnsBatchSize {
				break
			}
			page++
		}
		if checked > 0 {
			slog.Debug("dns recheck completed", "checked", checked)
		}
		return nil
	}
}
