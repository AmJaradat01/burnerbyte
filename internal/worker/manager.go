package worker

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type Job struct {
	Name     string
	Interval time.Duration
	Fn       func(ctx context.Context) error
}

type Manager struct {
	jobs []Job
}

func NewManager() *Manager {
	return &Manager{}
}

func (m *Manager) Add(name string, interval time.Duration, fn func(ctx context.Context) error) {
	m.jobs = append(m.jobs, Job{Name: name, Interval: interval, Fn: fn})
}

func (m *Manager) Start(ctx context.Context) {
	var wg sync.WaitGroup
	for _, job := range m.jobs {
		wg.Add(1)
		go func(j Job) {
			defer wg.Done()
			slog.Info("worker started", "name", j.Name, "interval", j.Interval)
			ticker := time.NewTicker(j.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					slog.Info("worker stopped", "name", j.Name)
					return
				case <-ticker.C:
					if err := j.Fn(ctx); err != nil {
						slog.Error("worker error", "name", j.Name, "error", err)
					}
				}
			}
		}(job)
	}
	wg.Wait()
}
