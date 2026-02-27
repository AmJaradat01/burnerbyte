package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type AdminHandler struct{ analyticsSvc *service.AnalyticsService }

func NewAdminHandler(analyticsSvc *service.AnalyticsService) *AdminHandler {
	return &AdminHandler{analyticsSvc: analyticsSvc}
}

func (h *AdminHandler) Routes(r chi.Router) {
		r.Use(auth.RequireSystemAdmin)
		r.Get("/admin/stats", h.Stats)
}

func (h *AdminHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.analyticsSvc.GetSystemStats(r.Context())
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, stats)
}
