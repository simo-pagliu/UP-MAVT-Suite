# UP-MAVT Suite
Presentation of the software and purpose, link to the publication

## Deployment
The UP-MAVT Suite is availble online at (LINK), hosted by PSI in Switerland. If you desire to improve on this code you might want to deploy it locally: The current repo provides everything required for a deployment with docker compose. Once installed docker follownig the official doc (REF), you can run all by using docker compose up --build -d

### Note for production deployment
To deploy in a production enviroment we suggest to separatly build docker images and tag them to properly version them. **It is also important to build the frontend properly without the development enviroment**:
#### Backend
```bash
cd ./UP-MAVT-Suite/backend
sudo docker build -t up-mavt-suite-backend .
```

#### Frontend (production build)
```bash
cd ./UP-MAVT-Suite/frontend
sudo docker build --target production -t up-mavt-suite-frontend .
```

#### Worker
```bash
cd ./UP-MAVT-Suite/worker
sudo docker build -t up-mavt-suite-worker .
```

## User Manual
Here we explain what user have to do to use this software

## Examples
You can find example case studies in the examples folder.
To use then, download them and upload the file in the UI (follow instruction X.X)
example_1.zip contains the validation case study from (DOI)
example_2.zip is a variation of the validation case study with added uncertanty and a secon stakeholder
example_3.zip is a larger case study with hierarchical strucure from the author's master thesis (REF)
(examples 1 and 2 are presented in this software publication (DOI))