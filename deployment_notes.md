# Deployment Notes

If your user is already in the `docker` group, you can omit `sudo` from all commands below.

## 1. Build Images

### Backend
```bash
cd ./UP-MAVT-Suite
sudo docker build -f backend/Dockerfile -t up-mavt-suite-backend .
```

### Frontend (production build)
```bash
cd ./UP-MAVT-Suite/frontend
sudo docker build --target production -t up-mavt-suite-frontend .
```

### Worker
```bash
cd ./UP-MAVT-Suite/worker
sudo docker build -t up-mavt-suite-worker .
```

## 2. Tag Images

```bash
sudo docker tag up-mavt-suite-backend  gitea.psi.ch/images/up-mavt-suite-backend:VERSION_TAG
sudo docker tag up-mavt-suite-frontend gitea.psi.ch/images/up-mavt-suite-frontend:VERSION_TAG
sudo docker tag up-mavt-suite-worker   gitea.psi.ch/images/up-mavt-suite-worker:VERSION_TAG
```

## 3. Login to PSI Gitea Registry

For this step the "password" is a token.  
To generate a token in Gitea go into Settings > Applications > Manage Access Tokens.
Grant the token both read and write permissions.

```bash
sudo docker login gitea.psi.ch -u USER
```
It will then prompt to ask the password (token)

## 4. Push Images

```bash
sudo docker push gitea.psi.ch/images/up-mavt-suite-backend:VERSION_TAG
sudo docker push gitea.psi.ch/images/up-mavt-suite-frontend:VERSION_TAG
sudo docker push gitea.psi.ch/images/up-mavt-suite-worker:VERSION_TAG
```

## 5. Update docker compose on gitea
Remember to update the versioning tag on the docker compose of linux-hosting in gitea