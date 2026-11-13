-- AdminFlow V1 — real company setup (run ONCE as DB admin, on `development` first, then production).
-- Replace <OWNER_EMAIL> at run time. Never commit the real email or the returned token.
-- Group name is internal only (owner chose to leave it blank in the UI).

select app.bootstrap_company(
  'Group Utama',
  'Muhammad Amir Luqman',
  '<OWNER_EMAIL>',
  '[
     {"name": "AMIR FOOD INDUSTRY SERVICES", "registration_no": "UT0027949-W",               "outlets": ["Amir Food"]},
     {"name": "Kedai Tiga Intan",            "registration_no": "201503015155 (UT0008144-V)", "outlets": ["Restoran 3 Intan"]},
     {"name": "RA World Resources",          "registration_no": "003705782-H",               "outlets": ["Lubok Sarapan"]}
   ]'::jsonb
);
-- Returns owner_invitation_token: give it to the Owner privately; they sign up with <OWNER_EMAIL>,
-- verify the email, then the app calls rpc('accept_invitation', { p_token }).
