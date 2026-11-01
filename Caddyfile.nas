https://{$DOMAIN} {
    tls internal
    encode zstd gzip
    @api path /api/* /socket.io/*
    reverse_proxy @api app:3000
    root * /srv
    file_server
}
