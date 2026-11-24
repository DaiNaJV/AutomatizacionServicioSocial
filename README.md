# Servicio Social en Línea — NexoTec

Prototipo académico para organizar el seguimiento del Servicio Social del TecNM Campus Matehuala. Su interfaz toma como referencia patrones de navegación del SII del TecNM (encabezado institucional, menú lateral, tablas y estados de trámite), sin copiar su identidad gráfica ni conectarse a sus servicios.

> **Importante:** es un prototipo local. No es una plataforma oficial del TecNM, no consulta el SII real y no emite constancias institucionales válidas. Los datos incluidos son ficticios.

## Tecnologías
- PHP 8.0 o superior
- MySQL / MariaDB
- HTML5 y CSS3
- XAMPP (Apache + MySQL)

## Instalación en XAMPP
1. Descomprime la carpeta `Servicio_Social_en_Linea` dentro de `C:\xampp\htdocs\`.
2. Inicia Apache y MySQL desde XAMPP.
3. Abre `http://localhost/phpmyadmin`.
4. Importa `database.sql`.
5. Revisa `config/database.php`. La configuración inicial usa `127.0.0.1`, base `servicio_social`, usuario `root` y contraseña vacía (configuración local típica de XAMPP).
6. Abre `http://localhost/Servicio_Social_en_Linea/`.

## Cuentas de demostración
Todas usan la contraseña inicial `password`.

| Rol | Correo | Permisos principales |
|---|---|---|
| Administrador | admin@demo.local | Gestión de estudiantes, revisión documental y aprobación administrativa final |
| Estudiante | alumno@demo.local | Consulta su expediente, carga, descarga y corrige sus documentos pendientes |
| Supervisor | supervisor@demo.local | Consulta expedientes, descarga documentos y valida, observa o rechaza entregas |

Cambia las contraseñas antes de cualquier demostración compartida. Las cuentas y los expedientes de ejemplo son ficticios.

## Funcionalidades
- Inicio de sesión y panel de acuerdo con el rol.
- Interfaz inspirada en la organización del SII: menú lateral, encabezado institucional, tablas, etiquetas de estado y navegación por módulos.
- Guía visible del proceso en tres etapas: inicio, desarrollo y cierre.
- Alta de estudiantes y creación de expediente inicial (administrador).
- Carga de documentos PDF/JPG/PNG de hasta 5 MB y alerta por posible folio duplicado.
- Descarga protegida de documentos: cada estudiante solo puede descargar archivos de su propio expediente; administrador y supervisor pueden consultar los documentos para sus tareas.
- Edición de documentos por parte del estudiante mientras estén recibidos, observados o rechazados. Puede corregir datos y reemplazar el archivo; al guardar, el documento vuelve a revisión.
- Revisión por personal: validado, observado o rechazado. La opción de aprobación administrativa final solo está disponible para el administrador.
- Registro de reportes bimestrales y acumulación de horas.
- Consulta y actualización del estado del expediente; la liberación final está reservada al administrador.
- Bitácora de movimientos.
- Diseño adaptable a escritorio y móvil.

## Flujo que explica la interfaz
1. **Inicio:** verificar el requisito de créditos, completar inducción, seleccionar programa y reunir los documentos de incorporación.
2. **Desarrollo:** registrar actividades y horas, entregar plan de trabajo y reportes bimestrales, y atender la evaluación de la instancia receptora.
3. **Cierre:** entregar reporte final y carta de terminación; el área responsable revisa el expediente y gestiona la constancia y liberación.

La secuencia y los documentos exactos deben cotejarse con los formatos vigentes del Campus Matehuala. El material de análisis señala como referencia 70% de créditos, 500 horas y un periodo de 6 a 24 meses; el plazo de cinco días hábiles para reportes es un supuesto pendiente de confirmación local.

## Seguridad y límites
- Los archivos se entregan mediante una ruta de descarga que comprueba la sesión y el rol. La carpeta `uploads` incluye una regla para impedir la ejecución directa de archivos.
- No se deben subir expedientes ni documentos reales de estudiantes a este prototipo ni publicarlo en internet con las cuentas de demostración.
- Antes de producción se requiere, como mínimo, HTTPS, protección CSRF, validación MIME robusta, almacenamiento privado fuera del directorio público, política de contraseñas, control de acceso por programa, respaldos, aviso de privacidad y pruebas de seguridad.
- La detección de folios repetidos es una alerta; no autentica firmas ni sellos. La revisión de documentos y las autorizaciones oficiales siguen siendo responsabilidad del personal autorizado.
- El prototipo no está integrado al SII, no consulta créditos institucionales, no envía correos reales y no genera constancias oficiales.

## Preparación para GitHub
- Mantén el repositorio privado mientras uses cuentas de demostración y datos de prueba.
- No incluyas archivos reales de estudiantes, contraseñas, credenciales institucionales ni documentos privados.
- La carpeta `uploads` se excluye mediante `.gitignore`; conserva únicamente su archivo `.htaccess`.
