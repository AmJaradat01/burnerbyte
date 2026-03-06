pipeline {
    agent any

    parameters {
        gitParameter(
            name: 'TAG',
            type: 'PT_TAG',
            defaultValue: 'latest',
            description: 'Git tag to build and deploy',
            sortMode: 'DESCENDING_SMART'
        )
    }

    environment {
        APP_NAME    = 'burnerbyte'
        DEPLOY_HOST = credentials('burnerbyte-deploy-host')
        INFISICAL_URL = credentials('INFISICAL_API_URL')
    }

    tools {
        go 'go-1.25'
        nodejs 'node-22'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scmGit(
                    branches: [[name: "refs/tags/${params.TAG}"]],
                    userRemoteConfigs: [[
                        url: 'git@gitlab.com:burnerbyte/burnerbyte.git',
                        credentialsId: 'gitlab-ssh-key'
                    ]]
                )
            }
        }

        stage('Build Go') {
            steps {
                sh '''
                    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/api ./cmd/api
                    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/smtpd ./cmd/smtpd
                '''
            }
        }

        stage('Build Frontend') {
            steps {
                dir('web') {
                    sh '''
                        corepack enable
                        pnpm install --frozen-lockfile
                        pnpm build
                    '''
                }
            }
        }

        stage('Archive') {
            steps {
                sh """
                    mkdir -p dist

                    # Go binaries + migrations
                    cp bin/api bin/smtpd dist/
                    cp -r migrations dist/

                    # Frontend standalone
                    cp -r web/.next/standalone dist/frontend
                    cp -r web/.next/static dist/frontend/.next/static
                    [ -d web/public ] && cp -r web/public dist/frontend/public

                    tar -czf ${APP_NAME}-${params.TAG}.tar.gz -C dist .
                """
                archiveArtifacts artifacts: "${APP_NAME}-${params.TAG}.tar.gz", fingerprint: true
            }
        }

        stage('Deploy') {
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'burnerbyte-deploy-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    sh """
                        scp -i \$SSH_KEY -o StrictHostKeyChecking=no ${APP_NAME}-${params.TAG}.tar.gz \$SSH_USER@${DEPLOY_HOST}:/tmp/${APP_NAME}.tar.gz
                        scp -i \$SSH_KEY deploy/remote-deploy.sh \$SSH_USER@${DEPLOY_HOST}:/tmp/burnerbyte-deploy.sh
                        ssh -i \$SSH_KEY \$SSH_USER@${DEPLOY_HOST} 'chmod +x /tmp/burnerbyte-deploy.sh && /tmp/burnerbyte-deploy.sh ${params.TAG}'
                    """
                }
            }
        }
    }

    post {
        failure { echo "❌ Deployment of ${params.TAG} FAILED" }
        success { echo "✅ ${APP_NAME} ${params.TAG} deployed" }
        always  { sh 'rm -rf dist bin' }
    }
}
