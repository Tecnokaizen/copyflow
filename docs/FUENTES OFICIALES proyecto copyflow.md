### Fuentes oficiales

Vercel define precisamente una aplicación multi-tenant como una aplicación que sirve a múltiples clientes **desde un único codebase y un único deployment**, dando a cada tenant su dominio o subdominio. Su documentación específica dice que solo hay un deployment de Next.js ejecutándose para todos los tenants. 

Además, Vercel describe actualmente su modalidad **Multi-Tenant Platforms** con wildcard domains, custom domains, middleware para resolver el hostname y, literalmente en términos arquitectónicos, un **single deployment model: deploy once, changes apply to all tenants**. Esto coincide exactamente con Copyflow. 

Los wildcard domains tipo `*.copyflow.com` están soportados a nivel de proyecto; Vercel los presenta específicamente como mecanismo para escalar aplicaciones multi-tenant. Hay un detalle operativo importante que deberemos tener presente cuando configuremos el dominio definitivo: Vercel exige actualmente usar sus **nameservers** para un wildcard domain gestionado de esta manera, debido a la generación de certificados wildcard. 

Para dominios propios de los tenants, Vercel permite añadir dominios a un proyecto y gestionarlos programáticamente mediante API/SDK. Por tanto, `app.sur4.es` puede terminar asociado al **mismo proyecto Copyflow**, sin crear otro deployment. 

Por el lado de Supabase, RLS es precisamente el mecanismo PostgreSQL que permite limitar qué filas puede ver o modificar un usuario. Supabase explica que una policy actúa conceptualmente como un `WHERE` añadido automáticamente a las consultas y recomienda combinar **Supabase Auth + RLS** para seguridad de extremo a extremo. 

Supabase también recomienda utilizar RLS para la autorización a nivel de aplicación, en vez de crear roles PostgreSQL diferentes por usuario/cliente. Para Copyflow eso respalda nuestro esquema de `memberships + tenant_id + RLS`. 

Un punto que quiero dejar especialmente fijado: **RLS no será un añadido posterior**. Supabase recomienda habilitarlo en las tablas expuestas y configurar permisos con mínimo privilegio. Además, las claves `service_role`/secretas omiten RLS, por lo que solo podrán utilizarse en backend controlado y nunca como mecanismo normal de acceso de los tenants. 

Con este bloque metido en las instrucciones del proyecto, la regla queda inequívoca: **Copyflow = 1 Vercel + 1 Supabase + N tenants.**