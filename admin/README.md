# KBO Play CMS 정적 퍼블리싱

## EC2 배포 예시

현재 `app.html`이 `/var/www/html/app.html`에 있다면:

```bash
sudo mkdir -p /var/www/html/admin
sudo cp -R kbo-play-admin/* /var/www/html/admin/
sudo chown -R nginx:nginx /var/www/html/admin
sudo find /var/www/html/admin -type d -exec chmod 755 {} \;
sudo find /var/www/html/admin -type f -exec chmod 644 {} \;
sudo nginx -t
sudo systemctl reload nginx
```

Ubuntu Nginx의 실행 계정이 `www-data`이면 `nginx:nginx` 대신 `www-data:www-data`를 사용합니다.

접속 주소:

```text
https://dev-game.spotistics.com/admin/index.html
```

현재는 API 연결 전 Dummy Data 기반 Prototype입니다.
