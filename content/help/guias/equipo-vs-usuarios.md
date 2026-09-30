---
title: Equipo frente a Usuarios y permisos
---

## Qué puedes hacer aquí

Son dos cosas distintas:

- Equipo / Personal: personas operativas para asignar pedidos, ver carga y responsables.
- Usuarios y permisos: autenticación, invitación y rol de acceso a Gestcopy.

Tener ficha en Personal no abre la aplicación. Tener usuario no implica automáticamente aparecer como responsable, aunque puedes vincular ambas cosas.

## Cómo hacerlo

1. Si solo necesitas asignar trabajo: alta en Personal.
2. Si necesita entrar en Gestcopy: invitación en Usuarios y permisos (propietario/administrador).
3. Si quieres ambas, crea Personal e invita (o invita marcando crear ficha en Personal). Si el usuario ya existe, **Dar acceso** en Personal lo vincula sin crear sesión nueva.

## Qué ocurre después

Personal sin usuario: «Sin acceso». Usuario vinculado: «Con acceso». Una invitación pendiente no muestra «Con acceso» hasta que haya `user_id`. Los pedidos usan Personal; el login usa Usuarios y permisos.

## Quién puede hacerlo

Gestión de Personal: propietario, administrador y responsable. Invitaciones y roles: propietario y administrador.

## Ejemplo práctico

Producción tiene tres personas en Personal. Solo dos entran a Gestcopy porque fueron invitadas; la tercera recibe pedidos asignados por el mostrador pero no inicia sesión.
