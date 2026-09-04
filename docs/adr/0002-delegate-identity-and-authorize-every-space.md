# Delegate identity and authorize every space

Dig delegates sign-in to one installation-configured OpenID Connect provider, completes authentication on the server, and gives the browser only a server-side session cookie. Every request checks active space membership before services or repositories run; owned records carry space identity and database constraints prevent cross-space relationships. This avoids storing credentials and keeps authorization explicit without taking on PostgreSQL row-level security.
