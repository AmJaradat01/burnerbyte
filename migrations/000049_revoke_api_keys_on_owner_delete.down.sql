DROP TRIGGER IF EXISTS trg_revoke_api_keys_on_owner_delete ON users;
DROP FUNCTION IF EXISTS revoke_api_keys_on_owner_delete();
