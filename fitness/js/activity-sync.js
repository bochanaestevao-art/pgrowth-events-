(function () {
  "use strict";

  const HISTORY_KEY = "pgrowth_fitness_run_history_v1";
  const SYNC_KEY_PREFIX = "pgrowth_fitness_activity_synced_v1:";
  let syncing = false;
  let requestedAgain = false;

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function getUserId() {
    const session = window.PGrowthSession?.read?.();
    return session?.user?.id || null;
  }

  function readSynced(userId) {
    try {
      const value = JSON.parse(
        localStorage.getItem(SYNC_KEY_PREFIX + userId) || "[]"
      );
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  function saveSynced(userId, ids) {
    localStorage.setItem(
      SYNC_KEY_PREFIX + userId,
      JSON.stringify(Array.from(ids))
    );
  }

  async function synchronize() {
    if (syncing) {
      requestedAgain = true;
      return;
    }

    syncing = true;

    try {
      const userId = getUserId();
      if (!userId || !window.PGrowthSession?.syncActivities) return;

      const synced = readSynced(userId);
      const pending = readHistory().filter(record =>
        record &&
        record.id &&
        !synced.has(record.id)
      );

      for (let index = 0; index < pending.length; index += 25) {
        const batch = pending.slice(index, index + 25);

        const result = await window.PGrowthSession.syncActivities(batch);

        if (!result?.success || !Array.isArray(result.syncedClientActivityIds)) {
          throw new Error("A API não confirmou a sincronização.");
        }

        result.syncedClientActivityIds.forEach(id => synced.add(id));
        saveSynced(userId, synced);
      }

    } catch (error) {
      console.warn(
        "Sincronização de corridas pendente. Será tentada novamente.",
        error?.message || ""
      );
    } finally {
      syncing = false;

      if (requestedAgain) {
        requestedAgain = false;
        synchronize();
      }
    }
  }

  window.addEventListener("pgrowth:run-saved", synchronize);

  window.addEventListener("online", synchronize);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) synchronize();
  });

  synchronize();
})();
