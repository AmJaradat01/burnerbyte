"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";

export function useOrgBootstrap() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();
  const { orgs, currentOrg, fetchOrgs, setCurrentOrg, fetchTeams, fetchRole } = useOrgStore();
  const orgsFetched = useRef(false);

  useEffect(() => {
    if (user) fetchOrgs().then(() => { orgsFetched.current = true; });
  }, [user, fetchOrgs]);

  useEffect(() => {
    if (!orgsFetched.current || !user) return;
    if (orgs.length === 0 && pathname !== "/onboarding" && localStorage.getItem("bb_onboarding_done") !== "true") {
      router.replace("/onboarding");
    }
  }, [orgs, user, pathname, router]);

  useEffect(() => {
    if (orgs.length > 0 && !currentOrg) setCurrentOrg(orgs[0]);
  }, [orgs, currentOrg, setCurrentOrg]);

  useEffect(() => {
    if (currentOrg) fetchTeams(currentOrg.id);
  }, [currentOrg, fetchTeams]);

  useEffect(() => {
    if (currentOrg && user) fetchRole(currentOrg.id, user.id);
  }, [currentOrg, user, fetchRole]);
}
