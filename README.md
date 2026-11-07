# App del CV Yejarafe

App web gratuita para el móvil. Funciona sin conexión una vez instalada.

## Secciones
- **Inicio**: próximo evento con confirmaciones, último resultado, asistencia, cuotas pendientes y últimas notas.
- **Calendario**: entrenos y partidos con hora y lugar. Cada uno tiene:
  - Convocatoria: enviar por WhatsApp y ver quién va. Con la hoja de Google conectada, cada jugadora confirma desde un enlace.
  - Pasar lista (presente, ausente, tarde o justificado).
  - En partidos: marcador en directo por sets, puntos por ataque, bloqueo y saque, errores, notas de recepción y saque de 0 a 3.
  - En entrenos: plan con ejercicios de la biblioteca.
  - Botón para añadirlo a Google Calendar.
- **Plantilla**: jugadoras con foto o avatar y ficha individual (asistencia, estadísticas, notas privadas, cuotas y vídeos).
- **Estadísticas**: temporada, sets ganados y perdidos por número de set, tabla por jugadora y partido a partido.
- **Más**: vídeos (YouTube o Drive), rotación, ejercicios, notas, cuotas y gastos, y datos/Google.
- **Pizarra táctica** (Más): mueve jugadores y balón, dibuja flechas, pases y trazos libres, crea varios pasos y reprodúcelos animados. Las jugadas se guardan.
- **Rotación y sistemas** (Más): alineación y sistemas 5-1, 4-2, 6-2 o propios, con las 6 rotaciones en recepción, saque y base, y aviso si hay falta de posición.
- **Ligas** (Más): los 4 grupos reales de la Liga Canaria Sénior 2026-27 (masculina Tenerife y Las Palmas, femenina Oro y Plata). Clasificación oficial, calendario con pabellones, resultados set a set y escudos se descargan solos de la federación (Leverade) cada 3 horas o con el botón Actualizar. Las plantillas del Yejarafe se cargan con nombres; dorsal y posición se ponen a mano. Nunca se guardan fechas de nacimiento.
- **Datos de ejemplo**: en Más › Datos y Google se pueden cargar 13 jugadoras de prueba y quitarlas después.

## Instalarla en el móvil, la tablet o el ordenador
- **iPhone / iPad**: abre la dirección en Safari › botón Compartir › «Añadir a pantalla de inicio».
- **Android (móvil o tablet)**: Chrome › menú ⋮ › «Instalar aplicación».
- **Ordenador**: Chrome o Edge › icono de instalar en la barra de direcciones.
En pantallas grandes el menú pasa a un lateral y el inicio se muestra en columnas.

## Conectar la hoja de Google (para compartir datos)
Hoja: "CV Yejarafe – Datos de la app" en Google Drive.
1. Abre la hoja › Extensiones › Apps Script.
2. Borra lo que haya, pega el contenido de `Codigo.gs` y guarda.
3. Implementar › Nueva implementación › tipo "Aplicación web" › Ejecutar como "Yo" › Acceso "Cualquier usuario" › Implementar.
4. Autoriza (Configuración avanzada › Ir a… › Permitir).
5. Copia la URL que termina en `/exec` y pégala en la app: Más › Datos y Google › Conectar.
6. Para otro entrenador: en esa misma pantalla, "Enlace para otro entrenador".

## Publicarla gratis en GitHub Pages
1. Crea un repositorio en github.com (por ejemplo `voleibol`).
2. Sube `index.html`, `manifest.json`, `sw.js` e `icon.svg` (el `Codigo.gs` no hace falta en el repo).
3. Settings › Pages › Branch `main` › Save.
4. En un minuto estará en `https://TU_USUARIO.github.io/voleibol/`.
