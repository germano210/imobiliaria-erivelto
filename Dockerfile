FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html favicon.svg /srv/
COPY css/ /srv/css/
COPY fonts/ /srv/fonts/
COPY img/ /srv/img/
COPY js/ /srv/js/
COPY video/ /srv/video/
