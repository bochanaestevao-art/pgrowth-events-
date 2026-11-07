"use strict";

self.addEventListener("push", function(event) {
  let payload = {};

  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (error) {
    payload = {
      body: event.data ? event.data.text() : ""
    };
  }

  const title =
    payload.title || "BMS Ticket Reminder";

  const options = {
    body:
      payload.body ||
      "Tens lembretes de compra para hoje.",
    icon: new URL("./bms-icon.svg", self.registration.scope).href,
    badge: new URL("./bms-icon.svg", self.registration.scope).href,
    tag: payload.tag || "bms-reminder",
    renotify: false,
    data: {
      url: payload.url || "./BMS%20Ticket%20Reminder.html"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url ||
      "./BMS%20Ticket%20Reminder.html",
    self.registration.scope
  ).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(function(windowClients) {
      for (const client of windowClients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
