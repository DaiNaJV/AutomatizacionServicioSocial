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

| Rol | Correo | Qué puede hacer |
|---|---|---|
| Estudiante | alumno@demo.local | Ver su expediente y horas, entregar y corregir documentos, enviar reportes bimestrales |
| Supervisión | supervisor@demo.local | Consultar expedientes, descargar documentos y validarlos, observarlos o rechazarlos |
| Administración | admin@demo.local | Todo lo anterior, registrar estudiantes, aprobar documentos oficialmente y liberar expedientes |

Los estudiantes que registre Administración entran con el correo y la contraseña temporal que se les asignó.

## Funcionalidades

- Acceso por rol y pestañas de navegación según permisos.
- Inicio del estudiante con "Lo que sigue" (pendientes calculados de su expediente), regla de horas (0 a 500) y etapas: inicio, desarrollo y cierre.
- Bandeja del personal con documentos por revisar, expedientes en pre-registro y expedientes listos para liberación.
- Alta de estudiantes con apertura automática de expediente.
- Entrega de documentos con validación de formato y tamaño, y alerta de folio duplicado.
- Corrección de documentos recibidos, observados o rechazados; al guardar vuelven a revisión.
- Descarga de documentos: cada estudiante solo descarga los de su expediente.
- Revisión por el personal con observación obligatoria; la aprobación oficial es solo de Administración.
- Reportes bimestrales (uno por periodo) que suman horas al expediente.
- Cambio de estado del expediente; la liberación final es solo de Administración.
- Bitácora agrupada por día.
- Diseño adaptable a celular y escritorio, con foco visible para teclado.

## Limitaciones de la versión estática

- No hay servidor: los permisos se controlan en el navegador, por lo que es una demostración y no un sistema seguro.
- No se deben subir documentos reales de estudiantes.
- Para un sistema real con datos compartidos se necesita un backend (por ejemplo PHP + MySQL en un hosting con PHP, o un servicio como Firebase o Supabase).

## Versión PHP original

La carpeta `version-php/` conserva la versión original en PHP + MySQL para XAMPP (`index.php`, `includes/`, `config/`, `database.sql`). GitHub Pages no la ejecuta; sirve como referencia o para correrla en XAMPP.
