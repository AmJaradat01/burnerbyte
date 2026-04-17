package worker

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/dns"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

const dnsBatchSize = 100

func DNSRecheckJob(domainRepo *postgres.DomainRepo, verHistoryRepo *postgres.VerificationHistoryRepo, expectedMXHost string) func(ctx context.Context) error {
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
				mx, mxErr := dns.VerifyMX(d.DomainName, expectedMXHost)
				txt, txtErr := dns.VerifyTXT(d.DomainName, dns.GenerateVerificationRecord(d.ID.String()))
				spf, spfErr := dns.VerifySPF(d.DomainName, expectedMXHost)

				if mx != d.MXVerified || txt != d.TXTVerified || spf != d.SPFVerified {
					if err := domainRepo.UpdateDNSStatus(ctx, d.ID, mx, txt, spf); err != nil {
						slog.Error("dns recheck update failed", "domain", d.DomainName, "error", err)
						continue
					}
					slog.Info("dns status changed", "domain", d.DomainName, "mx", mx, "txt", txt, "spf", spf)

					// Record verification history
					if verHistoryRepo != nil {
						now := time.Now()
						var errDetails *string
						var errParts []string
						if mxErr != nil {
							errParts = append(errParts, "mx: "+mxErr.Error())
						}
						if txtErr != nil {
							errParts = append(errParts, "txt: "+txtErr.Error())
						}
						if spfErr != nil {
							errParts = append(errParts, "spf: "+spfErr.Error())
						}
						if len(errParts) > 0 {
							combined := strings.Join(errParts, "; ")
							errDetails = &combined
						}
						record := &domain.VerificationHistory{
							ID:            uuid.New(),
							DomainID:      d.ID,
							CheckedAt:     now,
							MXResult:      mx,
							TXTResult:     txt,
							SPFResult:     spf,
							TriggerSource: "background",
							ErrorDetails:  errDetails,
						}
						if err := verHistoryRepo.Create(ctx, record); err != nil {
							slog.Error("dns recheck history insert failed", "domain", d.DomainName, "error", err)
						}
					}
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
