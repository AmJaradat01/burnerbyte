"use client";

import { useEffect, useRef, useState } from "react";
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
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const fetchingOrgs = useRef(false);
  const prevPathname = useRef(pathname);

  // Fetch orgs once when user is available, and re-fetch when leaving /invite
  useEffect(() => {
    if (!user || fetchingOrgs.current) return;

    const leftInvite = prevPathname.current.startsWith("/invite") && !pathname.startsWith("/invite");
    prevPathname.current = pathname;

    if (orgsLoaded && !leftInvite) return;

    fetchingOrgs.current = true;
    // Intentional: synchronous setState to reset loading flag before async fetchOrgs; preserves bootstrap sequence
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrgsLoaded(false);
    fetchOrgs()
      .finally(() => { fetchingOrgs.current = false; setOrgsLoaded(true); });
  }, [user, fetchOrgs, pathname, orgsLoaded]);

  // Redirect to onboarding if user has no orgs and hasn't dismissed it
  useEffect(() => {
    if (!orgsLoaded || !user) return;

    // Don't redirect if on a path that should be left alone
    const shouldSkip = ONBOARDING_SKIP_PATHS.some((p) => pathname.startsWith(p));
    if (shouldSkip) return;

    if (orgs.length === 0 && localStorage.getItem("bb_onboarding_done") !== "true") {
      router.replace("/onboarding");
    }
  }, [orgs, orgsLoaded, user, pathname, router]);

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
    if (currentOrg && user) fetchRole(currentOrg.id);
  }, [currentOrg, user, fetchRole]);
}
