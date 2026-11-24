# Servicio Social en Línea — NexoTec

Prototipo académico para dar seguimiento al Servicio Social del TecNM Campus Matehuala: expedientes, entrega y revisión de documentos, reportes bimestrales y bitácora.

> **Importante:** es un prototipo. No es una plataforma oficial del TecNM, no consulta el SII y no emite constancias válidas. Los datos son ficticios.

## Cómo funciona esta versión

Esta versión es **100 % estática** (HTML, CSS y JavaScript), así que funciona en **GitHub Pages**, que no ejecuta PHP ni MySQL.

- Los datos (usuarios, expedientes, documentos, reportes y bitácora) se guardan en el navegador con `localStorage`.
- Los archivos que se suben (PDF, JPG o PNG de hasta 5 MB) se guardan en el navegador con `IndexedDB`.
- Cada navegador tiene su propia copia de los datos. Lo que hace un usuario en su computadora no lo ve otra persona en otra computadora. Para una demostración, usa un solo navegador y cambia de cuenta con "Cerrar sesión".
- El enlace "Restablecer datos de demostración" (pie de página) borra los cambios y vuelve a los datos de ejemplo.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub (puede ser público; los datos son ficticios).
2. Sube **el contenido** de esta carpeta a la raíz del repositorio: `index.html`, `assets/`, `.nojekyll`, `README.md` (y `version-php/` si quieres conservarla).
3. En el repositorio entra a **Settings → Pages**.
4. En **Source** elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
5. Espera uno o dos minutos y abre `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

Para probarlo en tu computadora basta con abrir `index.html` en el navegador, o servir la carpeta con `python -m http.server`.

## Cuentas de demostración

Todas usan la contraseña `password`. En la pantalla de acceso puedes tocar una cuenta para llenar el formulario.

| Cuenta | Correo | Para qué sirve en la demo |
|---|---|---|
| Ana (estudiante) | alumno@demo.local | Está en Desarrollo con 120 horas y un documento observado por el sistema |
| Jorge (estudiante) | jorge@demo.local | Le falta solo la carta de terminación: al entregarla se libera solo y descarga su constancia |
| Supervisión | supervisor@demo.local | Atiende solo las excepciones |
| Administración | admin@demo.local | Registra estudiantes, ve el porcentaje de decisiones automáticas y puede liberar manualmente un caso especial |

## Automatización del proceso

Un motor de reglas (`runEngine` en `assets/app.js`) corre al abrir la página y después de cada acción. Sin intervención humana:

- **Revisa cada documento al entregarlo:** formato y tamaño, que el contenido sea realmente PDF/JPG/PNG (no solo la extensión), duplicados comparando la huella SHA-256 del archivo, que corresponda a la etapa actual y que no esté repetido. Si todo está bien queda **validado** al instante; si no, queda **observado** con el motivo exacto.
- **Asigna folio y fecha** a cada documento.
- **Evalúa los reportes bimestrales:** horas dentro del rango, actividades descritas y formato firmado válido. Al evaluarse se suman las horas.
- **Asigna programa** según la carrera y el cupo disponible.
- **Bloquea** expedientes con menos de 70% de créditos y los desbloquea solo cuando se corrigen.
- **Calcula fechas:** inicio, plan de trabajo (20 días), vencimiento de cada reporte (cada 2 meses + 5 días) y término estimado (6 meses).
- **Avanza el estado** del expediente según sus requisitos: Inicio, Desarrollo y Cierre (14 requisitos).
- **Libera automáticamente** al cumplir todo, incluido el periodo mínimo de 6 meses, y genera la constancia en PDF con folio.
- **Avisa:** resultados de revisiones y recordatorios de fechas próximas o vencidas (pestaña Avisos).

**Solo pasa al personal (pestaña Excepciones):** archivos idénticos a los de otro estudiante, documentos de tipo "Otro", reportes con más de 250 horas, segundos intentos fallidos y créditos insuficientes. El inicio del personal muestra qué porcentaje de las decisiones tomó el sistema.

## Publicar cambios con un clic

El repositorio incluye `publicar.ps1` y una tarea de VS Code:

1. Abre en VS Code la carpeta del repositorio.
2. Presiona **Ctrl + Shift + B** (o escribe `.\publicar.ps1` en la terminal).
3. El script hace `git add`, commit con fecha, `pull`, `push`, espera a que GitHub Pages publique y abre la página.

Para poner un mensaje propio: `.\publicar.ps1 "Cambié los colores"`.

## Limitaciones de la versión estática

- No hay servidor: los permisos se controlan en el navegador, por lo que es una demostración y no un sistema seguro.
- No se deben subir documentos reales de estudiantes.
- Para un sistema real con datos compartidos se necesita un backend (por ejemplo PHP + MySQL en un hosting con PHP, o un servicio como Firebase o Supabase).

## Versión PHP original

La carpeta `version-php/` conserva la versión original en PHP + MySQL para XAMPP (`index.php`, `includes/`, `config/`, `database.sql`). GitHub Pages no la ejecuta; sirve como referencia o para correrla en XAMPP.
