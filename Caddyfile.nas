{
    default_sni {$DOMAIN}
}

https://{$DOMAIN} {
    tls internal
    encode zstd gzip
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
    @api path /api/* /socket.io/*
    reverse_proxy @api app:3000
    root * /srv
    file_server
}
