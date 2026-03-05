importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Horas programadas para el suplemento (hora local Venezuela UTC-4)
const HORAS_SUPLEMENTO = [12, 15, 18, 21];

// ==================== INDEXEDDB ====================
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
    return abrirDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('historial', 'readwrite');
        tx.objectStore('historial').put(item);
        tx.oncomplete = resolve;
        tx.onerror    = e => reject(e.target.error);
    }));
}

function formatHourSW(hour) {
    if (hour === 0 || hour === 24) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour > 12 ? `${hour - 12}:00 PM` : `${hour}:00 AM`;
}

function notificarPagina(clients, tipo, item) {
    clients.forEach(c => {
        c.postMessage({ type: 'NUEVA_NOTIF', item });
        if (tipo) c.postMessage({ type: 'INCREMENTAR_CONTADOR', idTipo: tipo });
    });
}

// ==================== NOTIFICATIONCLICK ====================
// Punto de captura único y confiable en Edge, Chrome y Firefox.
// Aquí siempre tenemos title, body y data completos.
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    const action = event.action;
    const notif  = event.notification;
    const data   = notif.data || {};
    const tipo   = data.tipo || 'suplemento';
    const iconos = { suplemento: '💊', parche: '🪝' };
    const ahora  = new Date();

    // Edge/OneSignal a veces no expone notif.title — usamos data.titulo como fallback
    const titulo  = notif.title  || data.titulo  || '🔔 Recordatorio';
    const mensaje = notif.body   || data.mensaje  || '';

    const item = {
        id:         ahora.getTime(),
        idTipo:     tipo,
        titulo,
        mensaje,
        icono:      iconos[tipo] || '🔔',
        hora:       formatHourSW(ahora.getHours()),
        fecha:      ahora.toLocaleDateString(),
        timestamp:  ahora.toISOString(),
        completado: false,   // siempre false al registrar; se marca después con MARK_DONE
        omitida:    false
    };

    if (action === 'done') {
        event.waitUntil(
            guardarEnHistorial(item).then(() =>
                self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                    // Primero NUEVA_NOTIF para insertar en historial, luego MARK_DONE para marcarlo
                    notificarPagina(clients, tipo, item);
                    setTimeout(() => {
                        clients.forEach(c => c.postMessage({ type: 'MARK_DONE', tipo }));
                    }, 100);
                    if (clients.length === 0) return self.clients.openWindow('/');
                })
            )
        );

    } else if (action === 'snooze') {
        let ms;
        if (tipo === 'suplemento') {
            ms = msParaProximoIntervalo();
            if (ms === null) return;
        } else {
            ms = 15 * 60 * 1000;
        }

        // Guardar en historial igualmente (el usuario lo vio)
        event.waitUntil(
            guardarEnHistorial(item).then(() =>
                self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                    notificarPagina(clients, tipo, item);
                }).then(() => new Promise(resolve => {
                    setTimeout(() => {
                        self.registration.showNotification(notif.title, {
                            body:             notif.body,
                            icon:             notif.icon,
                            data:             notif.data,
                            requireInteraction: true,
                            vibrate:          [300, 200, 300],
                            actions: [
                                { action: 'done',   title: '✅ ¡Hecho!' },
                                { action: 'snooze', title: tipo === 'suplemento' ? '⏰ Recordarme luego' : '⏰ Recordarme en 15 min' }
                            ]
                        });
                        resolve();
                    }, ms);
                }))
            )
        );

    } else {
        // Clic en el cuerpo — abrir/enfocar app y registrar
        event.waitUntil(
            guardarEnHistorial(item).then(() =>
                self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                    notificarPagina(clients, tipo, item);
                    const appClient = clients.find(c => c.url.includes(self.location.origin));
                    if (appClient) {
                        appClient.focus();
                    } else {
                        return self.clients.openWindow('/');
                    }
                })
            )
        );
    }
}, false);

// ==================== SNOOZE: calcular próximo intervalo ====================
function msParaProximoIntervalo() {
    const ahora     = new Date();
    const utcOffset = ahora.getTimezoneOffset() * 60000;
    const venezolana = new Date(ahora.getTime() + utcOffset - 4 * 3600000);

    const horaVE = venezolana.getHours();
    const minVE  = venezolana.getMinutes();
    const segVE  = venezolana.getSeconds();

    const proxima = HORAS_SUPLEMENTO.find(h => h > horaVE);
    if (proxima === undefined) return null;

    const segundos = (proxima - horaVE) * 3600 - minVE * 60 - segVE;
    return segundos * 1000;
}