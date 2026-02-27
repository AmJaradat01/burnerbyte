package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type EmailService struct {
	emailRepo *postgres.EmailRepo
	inboxRepo *postgres.InboxRepo
}

func NewEmailService(emailRepo *postgres.EmailRepo, inboxRepo *postgres.InboxRepo) *EmailService {
	return &EmailService{emailRepo: emailRepo, inboxRepo: inboxRepo}
}

func (s *EmailService) GetEmail(ctx context.Context, emailID, userID uuid.UUID) (*domain.Email, error) {
	email, err := s.emailRepo.GetByID(ctx, emailID)
	if err != nil {
		return nil, err
	}

	// Ownership check via inbox
	inbox, err := s.inboxRepo.GetByID(ctx, email.InboxID)
	if err != nil {
		return nil, err
	}
	if inbox.CreatedBy != userID {
		return nil, fmt.Errorf("forbidden: not your email")
	}

	// Auto-mark as read on preview
	if !email.IsRead {
		_ = s.emailRepo.MarkRead(ctx, emailID, true)
		email.IsRead = true
	}

	return email, nil
}

func (s *EmailService) ListByInbox(ctx context.Context, inboxID, userID uuid.UUID, page, perPage int) ([]domain.EmailSummary, int, error) {
	inbox, err := s.inboxRepo.GetByID(ctx, inboxID)
	if err != nil {
		return nil, 0, err
	}
	if inbox.CreatedBy != userID {
		return nil, 0, fmt.Errorf("forbidden: not your inbox")
	}
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.emailRepo.ListByInbox(ctx, inboxID, page, perPage)
}

func (s *EmailService) Search(ctx context.Context, inboxID, userID uuid.UUID, query string, page, perPage int) ([]domain.EmailSummary, int, error) {
	inbox, err := s.inboxRepo.GetByID(ctx, inboxID)
	if err != nil {
		return nil, 0, err
	}
	if inbox.CreatedBy != userID {
		return nil, 0, fmt.Errorf("forbidden: not your inbox")
	}
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.emailRepo.Search(ctx, inboxID, query, page, perPage)
}

func (s *EmailService) MarkReadUnread(ctx context.Context, emailID, userID uuid.UUID, isRead bool) error {
	email, err := s.emailRepo.GetByID(ctx, emailID)
	if err != nil {
		return err
	}
	inbox, err := s.inboxRepo.GetByID(ctx, email.InboxID)
	if err != nil {
		return err
	}
	if inbox.CreatedBy != userID {
		return fmt.Errorf("forbidden: not your email")
	}
	return s.emailRepo.MarkRead(ctx, emailID, isRead)
}

func (s *EmailService) DeleteEmail(ctx context.Context, emailID, userID uuid.UUID) error {
	email, err := s.emailRepo.GetByID(ctx, emailID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return fmt.Errorf("email not found")
		}
		return err
	}
	inbox, err := s.inboxRepo.GetByID(ctx, email.InboxID)
	if err != nil {
		return err
	}
	if inbox.CreatedBy != userID {
		return fmt.Errorf("forbidden: not your email")
	}
	return s.emailRepo.Delete(ctx, emailID)
}
