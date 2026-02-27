CREATE OR REPLACE FUNCTION update_email_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector = to_tsvector('english',
        COALESCE(NEW.subject, '') || ' ' ||
        COALESCE(NEW.body_text, '') || ' ' ||
        COALESCE(NEW.from_address, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emails_search_vector
    BEFORE INSERT OR UPDATE ON emails
    FOR EACH ROW EXECUTE FUNCTION update_email_search_vector();
