# Backend
cd ./UP-MAVT-Suite/backend
sudo docker build -t up-mavt-suite-backend .

# Frontend
cd ./UP-MAVT-Suite/frontend
sudo docker build -t up-mavt-suite-frontend .

# Worker
cd ./UP-MAVT-Suite/worker
sudo docker build -t up-mavt-suite-worker .

sudo docker tag up-mavt-suite-backend   gitea.psi.ch/images/up-mavt-suite-backend:0.1.0
sudo docker tag up-mavt-suite-frontend  gitea.psi.ch/images/up-mavt-suite-frontend:0.1.0
sudo docker tag up-mavt-suite-worker    gitea.psi.ch/images/up-mavt-suite-worker:0.1.0

sudo docker push gitea.psi.ch/images/up-mavt-suite-backend:0.1.0
sudo docker push gitea.psi.ch/images/up-mavt-suite-frontend:0.1.0
sudo docker push gitea.psi.ch/images/up-mavt-suite-worker:0.1.0