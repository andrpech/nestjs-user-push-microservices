#!/bin/sh
# Phase 13 — bootstrap a streaming-replication standby on first boot, then
# fall through to the standard postgres entrypoint to actually start the server.

set -eu

DATA_DIR="/var/lib/postgresql/data"

if [ ! -s "$DATA_DIR/PG_VERSION" ]; then
	echo "[replica] data dir empty — running pg_basebackup from primary"
	until PGPASSWORD=replpwd pg_basebackup \
			--host=postgres \
			--port=5432 \
			--username=replicator \
			--pgdata="$DATA_DIR" \
			--wal-method=stream \
			--checkpoint=fast \
			--slot=replica1 \
			--write-recovery-conf \
			--progress \
			--verbose; do
		echo "[replica] basebackup failed — retrying in 3s"
		rm -rf "$DATA_DIR"/*
		sleep 3
	done
	chmod 0700 "$DATA_DIR"
	echo "[replica] basebackup complete"
fi

exec docker-entrypoint.sh postgres
