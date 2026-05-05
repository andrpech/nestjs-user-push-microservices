CREATE DATABASE users;
CREATE DATABASE notifications;

-- Phase 13 — replication user + slot for streaming replica.
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replpwd';
SELECT pg_create_physical_replication_slot('replica1');
