<?php
if (session_status() === PHP_SESSION_NONE) session_start();
function h($v){ return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
function logged(){ return !empty($_SESSION['user']); }
function user(){ return $_SESSION['user'] ?? null; }
function require_login(){ if(!logged()){ header('Location: index.php?page=login'); exit; } }
function require_role($roles){ require_login(); if(!in_array(user()['role'],$roles,true)){ http_response_code(403); exit('No tienes permisos para realizar esta acción.'); } }
function flash($msg,$type='success'){ $_SESSION['flash']=['msg'=>$msg,'type'=>$type]; }
function log_event($pdo,$type,$description,$expediente=null){ $s=$pdo->prepare('INSERT INTO events(expediente_id,user_id,event_type,description) VALUES(?,?,?,?)'); $s->execute([$expediente,user()['id']??null,$type,$description]); }
function badge($status){ $map=['pre_registro'=>'secondary','en_proceso'=>'primary','pendiente_revision'=>'warning','observado'=>'warning','completo'=>'success','liberado'=>'success','baja'=>'danger','recibido'=>'secondary','validado'=>'success','aprobado'=>'success','rechazado'=>'danger','enviado'=>'primary','evaluado'=>'success','borrador'=>'secondary']; $label=str_replace('_',' ',$status); return '<span class="badge '.($map[$status]??'secondary').'">'.h(ucfirst($label)).'</span>'; }
function current_student_id($pdo){ $s=$pdo->prepare('SELECT id FROM students WHERE user_id=?');$s->execute([user()['id']]);return $s->fetchColumn(); }
