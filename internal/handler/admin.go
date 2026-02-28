package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type AdminHandler struct {
	analyticsSvc *service.AnalyticsService
	orgSvc       *service.OrgService
	pool         *pgxpool.Pool
	rdb          *redis.Client
}

func NewAdminHandler(analyticsSvc *service.AnalyticsService, orgSvc *service.OrgService, pool *pgxpool.Pool, rdb *redis.Client) *AdminHandler {
	return &AdminHandler{analyticsSvc: analyticsSvc, orgSvc: orgSvc, pool: pool, rdb: rdb}
}

func (h *AdminHandler) Routes(r chi.Router) {
		r.Use(auth.RequireSystemAdmin)
		r.Get("/admin/stats", h.Stats)
		r.Get("/admin/orgs", h.ListOrgs)
		r.Get("/admin/health", h.Health)
}

func (h *AdminHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.analyticsSvc.GetSystemStats(r.Context())
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, stats)
}

func (h *AdminHandler) ListOrgs(w http.ResponseWriter, r *http.Request) {
	page, perPage := parsePagination(r)
	orgs, total, err := h.orgSvc.ListAll(r.Context(), page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(orgs, total, page, perPage))
}

func (h *AdminHandler) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	health := map[string]string{}

	if err := h.pool.Ping(ctx); err != nil {
		health["postgres"] = "error: " + err.Error()
	} else {
		health["postgres"] = "ok"
	}

	if err := h.rdb.Ping(ctx).Err(); err != nil {
		health["redis"] = "error: " + err.Error()
	} else {
		health["redis"] = "ok"
	}

	status := http.StatusOK
	for _, v := range health {
		if v != "ok" {
			status = http.StatusServiceUnavailable
			break
		}
	}
	writeJSON(w, status, health)
}
