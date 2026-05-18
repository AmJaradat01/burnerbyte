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

func safeRun(fn func(ctx context.Context) error, ctx context.Context) error {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("worker panic recovered", "panic", r)
		}
	}()
	return fn(ctx)
}

func (m *Manager) Start(ctx context.Context) {
	var wg sync.WaitGroup
	for _, job := range m.jobs {
		if job.Interval <= 0 {
			slog.Error("worker has invalid interval, skipping", "name", job.Name)
			continue
		}
		wg.Add(1)
		go func(j Job) {
			defer wg.Done()
			slog.Info("worker started", "name", j.Name, "interval", j.Interval)

			// Run immediately on start
			if err := safeRun(j.Fn, ctx); err != nil {
				slog.Error("worker initial run error", "name", j.Name, "error", err)
			}

			ticker := time.NewTicker(j.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					slog.Info("worker stopped", "name", j.Name)
					return
				case <-ticker.C:
					if err := safeRun(j.Fn, ctx); err != nil {
						slog.Error("worker error", "name", j.Name, "error", err)
					}
				}
			}
		}(job)
	}
	wg.Wait()
}
