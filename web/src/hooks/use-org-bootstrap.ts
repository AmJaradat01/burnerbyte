"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";

/**
 * Paths where the onboarding redirect should NOT fire.
 * These are flows the user may be in the middle of that should not be interrupted.
 */
const ONBOARDING_SKIP_PATHS = ["/onboarding", "/invite", "/setup", "/docs"];

export function useOrgBootstrap() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();
  const { orgs, currentOrg, fetchOrgs, setCurrentOrg, fetchTeams, fetchRole } = useOrgStore();
  const orgsFetched = useRef(false);
  const fetchingOrgs = useRef(false);

  // Fetch orgs once when user is available
  useEffect(() => {
    if (!user || fetchingOrgs.current) return;
    fetchingOrgs.current = true;
    fetchOrgs()
      .then(() => { orgsFetched.current = true; })
      .catch(() => { orgsFetched.current = true; })
      .finally(() => { fetchingOrgs.current = false; });
  }, [user, fetchOrgs]);

  // Redirect to onboarding if user has no orgs and hasn't dismissed it
  useEffect(() => {
    if (!orgsFetched.current || !user) return;

    // Don't redirect if on a path that should be left alone
    const shouldSkip = ONBOARDING_SKIP_PATHS.some((p) => pathname.startsWith(p));
    if (shouldSkip) return;

    if (orgs.length === 0 && localStorage.getItem("bb_onboarding_done") !== "true") {
      router.replace("/onboarding");
    }
  }, [orgs, user, pathname, router]);

  // Auto-select first org
  useEffect(() => {
    if (orgs.length > 0 && !currentOrg) setCurrentOrg(orgs[0]);
  }, [orgs, currentOrg, setCurrentOrg]);

  // Fetch teams when org is selected
  useEffect(() => {
    if (currentOrg) fetchTeams(currentOrg.id);
  }, [currentOrg, fetchTeams]);

  // Fetch role when org and user are available
  useEffect(() => {
    if (currentOrg && user) fetchRole(currentOrg.id, user.id);
  }, [currentOrg, user, fetchRole]);
}
