importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Horas programadas para el suplemento (hora local Venezuela UTC-4)
const HORAS_SUPLEMENTO = [12, 15, 18, 21];

// ==================== INDEXEDDB (accesible desde SW) ====================
function abrirDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('recordatoriosDB', 1);
        req.onupgradeneeded = e => {
            e.target.result.createObjectStore('historial', { keyPath: 'id' });
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function guardarEnHistorial(item) {
    return abrirDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx    = db.transaction('historial', 'readwrite');
            const store = tx.objectStore('historial');
            store.put(item);
            tx.oncomplete = resolve;
            tx.onerror    = e => reject(e.target.error);
        });
    });
}

function formatHourSW(hour) {
    if (hour === 0 || hour === 24) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour > 12 ? `${hour - 12}:00 PM` : `${hour}:00 AM`;
}

// ==================== PUSH: registrar en historial al recibir ====================
// Usamos notificationclick en vez de push para no interferir con el handler de OneSignal.
// El registro en historial se hace cuando aparece la notificación (notificationshow).
self.addEventListener('notificationshow', function(event) {
    const notif  = event.notification;
    const data   = notif.data || {};
    const tipo   = data.tipo || 'suplemento';
    const iconos = { suplemento: '💊', parche: '🪝' };
    const ahora  = new Date();

    const item = {
        id:         ahora.getTime(),
        idTipo:     tipo,
        titulo:     notif.title || '🔔 Recordatorio',
        mensaje:    notif.body  || '',
        icono:      iconos[tipo] || '🔔',
        hora:       formatHourSW(ahora.getHours()),
        fecha:      ahora.toLocaleDateString(),
        timestamp:  ahora.toISOString(),
        completado: false,
        omitida:    false
    };

    event.waitUntil(
        guardarEnHistorial(item).then(() =>
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                clients.forEach(c => c.postMessage({ type: 'NUEVA_NOTIF', item }));
            })
        )
    );
});

/**
 * Calcula cuántos milisegundos faltan para el próximo intervalo del suplemento.
 * Si ya pasaron todos los del día, devuelve null (no reagenda).
 */
function msParaProximoIntervalo() {
    const ahora = new Date();
    const utcOffset = ahora.getTimezoneOffset() * 60000;
    const venezolana = new Date(ahora.getTime() + utcOffset - 4 * 3600000);

    const horaVE = venezolana.getHours();
    const minVE  = venezolana.getMinutes();
    const segVE  = venezolana.getSeconds();

    const proxima = HORAS_SUPLEMENTO.find(h => h > horaVE);
    if (proxima === undefined) return null; // No quedan intervalos hoy

    const minutosHastaProxima = (proxima - horaVE) * 60 - minVE;
    const segundosHastaProxima = minutosHastaProxima * 60 - segVE;
    return segundosHastaProxima * 1000;
}

self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    const action = event.action;
    const data   = event.notification.data || {};
    const tipo   = data.tipo || 'suplemento';

    if (action === 'done') {
        // Notificar a la página que marque como hecho
        event.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'MARK_DONE', tipo });
                });

                // Si no hay ventana abierta, ábrela
                if (clients.length === 0) {
                    return self.clients.openWindow('/');
                }
            })
        );

    } else if (action === 'snooze') {
        // Suplemento → próximo intervalo programado; otros → 15 minutos fijos
        let ms;
        if (tipo === 'suplemento') {
            ms = msParaProximoIntervalo();
            if (ms === null) return; // No quedan más intervalos hoy
        } else {
            ms = 15 * 60 * 1000; // 15 minutos
        }

        event.waitUntil(
            new Promise(resolve => {
                setTimeout(() => {
                    self.registration.showNotification(event.notification.title, {
                        body: event.notification.body,
                        icon: event.notification.icon,
                        data: event.notification.data,
                        requireInteraction: true,
                        vibrate: [300, 200, 300],
                        actions: [
                            { action: 'done',   title: '✅ ¡Hecho!' },
                            { action: 'snooze', title: tipo === 'suplemento' ? '⏰ Recordarme luego' : '⏰ Recordarme en 15 min' }
                        ]
                    });
                    resolve();
                }, ms);
            })
        );

    } else {
        // Clic en el cuerpo de la notificación — abrir/enfocar la app
        event.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                const appClient = clients.find(c => c.url.includes(self.location.origin));
                if (appClient) {
                    appClient.focus();
                    appClient.postMessage({ type: 'MARK_DONE', tipo });
                } else {
                    return self.clients.openWindow('/');
                }
            })
        );
    }
}, false);