(function () {
  if (!/^localhost$|^127\.0\.0\.1$/.test(location.hostname)) return;

  const probeUrl = "/assets/dev-heartbeat.json";
  let lastSnapshot = null;
  let inFlight = false;

  async function probe() {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(probeUrl, { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = await response.text();
      if (lastSnapshot === null) {
        lastSnapshot = snapshot;
        return;
      }
      if (snapshot !== lastSnapshot) {
        location.reload();
      }
    } catch {
      
    } finally {
      inFlight = false;
    }
  }

  probe();
  setInterval(probe, 1500);
})();
