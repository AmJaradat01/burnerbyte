-- api_keys.created_by is ON DELETE SET NULL, so deleting a user left the key
-- row behind with a null owner and is_active still true. Authentication fails
-- closed (the owner lookup misses and the request gets a 401), so this was
-- never exploitable — but the key reads as live in the API-keys list and in
-- any inventory built from the table, which is misleading during an incident.
--
-- Mark them revoked as part of the same statement that nulls the owner.
CREATE OR REPLACE FUNCTION revoke_api_keys_on_owner_delete() RETURNS TRIGGER AS $$
BEGIN
    UPDATE api_keys
       SET is_active  = FALSE,
           revoked_at = COALESCE(revoked_at, now())
     WHERE created_by = OLD.id
       AND is_active;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- BEFORE DELETE so created_by still points at the departing user; the
-- SET NULL from the foreign key then runs afterwards.
CREATE TRIGGER trg_revoke_api_keys_on_owner_delete
    BEFORE DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION revoke_api_keys_on_owner_delete();
