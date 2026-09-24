FROM nginx:stable-alpine

COPY docker/app/launchsite/nginx.conf /etc/nginx/conf.d/default.conf
COPY landing-site/public/ /usr/share/nginx/html/

EXPOSE 3001
