CREATE DATABASE IF NOT EXISTS servicio_social CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE servicio_social;
CREATE TABLE IF NOT EXISTS users (
 id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(160) NOT NULL UNIQUE,
 password VARCHAR(255) NOT NULL, role ENUM('admin','student','supervisor') NOT NULL DEFAULT 'student', active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS students (
 id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL UNIQUE, control_number VARCHAR(30) NOT NULL UNIQUE,
 career VARCHAR(120) NOT NULL, semester TINYINT UNSIGNED NOT NULL, credits_percent DECIMAL(5,2) NOT NULL DEFAULT 70,
 phone VARCHAR(30) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS programs (
 id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, receiver VARCHAR(160) NOT NULL,
 contact_name VARCHAR(120) NULL, contact_email VARCHAR(160) NULL, active TINYINT(1) DEFAULT 1
);
CREATE TABLE IF NOT EXISTS expedientes (
 id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, program_id INT NULL,
 status ENUM('pre_registro','en_proceso','pendiente_revision','observado','completo','liberado','baja') DEFAULT 'pre_registro',
 start_date DATE NULL, end_date DATE NULL, induction_done TINYINT(1) DEFAULT 0,
 work_plan_due DATE NULL, total_hours DECIMAL(7,2) DEFAULT 0, notes TEXT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES students(id), FOREIGN KEY(program_id) REFERENCES programs(id)
);
CREATE TABLE IF NOT EXISTS documents (
 id INT AUTO_INCREMENT PRIMARY KEY, expediente_id INT NOT NULL,
 type ENUM('solicitud','carta_compromiso','carta_aceptacion','plan_trabajo','reporte_bimestral','evaluacion','reporte_final','carta_terminacion','otro') NOT NULL,
 original_name VARCHAR(255) NOT NULL, stored_name VARCHAR(255) NOT NULL, folio VARCHAR(80) NULL,
 period_label VARCHAR(80) NULL, doc_date DATE NULL,
 status ENUM('recibido','validado','observado','rechazado','aprobado') DEFAULT 'recibido',
 validation_notes TEXT NULL, uploaded_by INT NOT NULL, reviewed_by INT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME NULL,
 FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE,
 FOREIGN KEY(uploaded_by) REFERENCES users(id), FOREIGN KEY(reviewed_by) REFERENCES users(id),
 INDEX(folio), INDEX(status)
);
CREATE TABLE IF NOT EXISTS reports (
 id INT AUTO_INCREMENT PRIMARY KEY, expediente_id INT NOT NULL, period_no TINYINT NOT NULL,
 activities TEXT NOT NULL, hours DECIMAL(7,2) NOT NULL DEFAULT 0,
 student_self_score DECIMAL(5,2) NULL, receiver_score DECIMAL(5,2) NULL,
 status ENUM('borrador','enviado','evaluado','observado') DEFAULT 'borrador', due_date DATE NULL,
 submitted_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY unique_period(expediente_id,period_no), FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (
 id INT AUTO_INCREMENT PRIMARY KEY, expediente_id INT NULL, user_id INT NULL,
 event_type VARCHAR(80) NOT NULL, description TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(expediente_id) REFERENCES expedientes(id) ON DELETE SET NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS settings (
 setting_key VARCHAR(80) PRIMARY KEY, setting_value VARCHAR(255) NOT NULL
);
INSERT IGNORE INTO settings(setting_key,setting_value) VALUES ('min_credits','70'),('required_hours','500'),('min_months','6'),('max_months','24'),('plan_due_days','20'),('report_due_days','5');
INSERT IGNORE INTO programs(id,name,receiver,contact_name,contact_email) VALUES
 (1,'Programa de apoyo comunitario','Ayuntamiento de Matehuala','Responsable de programa','supervisor@demo.local'),
 (2,'AlfabetizaTec','Programa institucional','Coordinación','supervisor@demo.local');
-- Cuentas de demostración. Contraseña inicial para las tres: password
INSERT IGNORE INTO users(id,name,email,password,role) VALUES
 (1,'Administración NexoTec','admin@demo.local','$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','admin'),
 (2,'Estudiante de prueba','alumno@demo.local','$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','student'),
 (3,'Supervisor de prueba','supervisor@demo.local','$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','supervisor');
INSERT IGNORE INTO students(id,user_id,control_number,career,semester,credits_percent,phone) VALUES (1,2,'22010001','Ingeniería en Sistemas Computacionales',8,78,'4880000000');
INSERT IGNORE INTO expedientes(id,student_id,program_id,status,start_date,end_date,induction_done,work_plan_due,total_hours) VALUES (1,1,1,'en_proceso',CURDATE(),DATE_ADD(CURDATE(),INTERVAL 6 MONTH),1,DATE_ADD(CURDATE(),INTERVAL 20 DAY),120);
