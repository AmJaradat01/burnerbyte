pipeline {
    agent any

    parameters {
        gitParameter(
            name: 'TAG',
            type: 'PT_TAG',
            defaultValue: 'latest',
            description: 'Git tag to build and deploy',
            sortMode: 'DESCENDING_SMART',
            selectedValue: 'TOP',
            tagFilter: 'v*',
            listSize: '10',
            quickFilterEnabled: true
        )
    }

    environment {
        APP_NAME    = 'burnerbyte'
        DEPLOY_HOST = credentials('burnerbyte-deploy-host')
        PATH        = "/usr/local/go/bin:${env.PATH}"
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

        stage('Test Backend') {
            steps {
                sh 'go test ./...'
            }
        }

        stage('Build Go') {
            steps {
                sh '''
                    go version
                    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-X main.Version=${TAG}" -o bin/api ./cmd/api
                    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/smtpd ./cmd/smtpd
                '''
            }
        }

        stage('Test & Build Frontend') {
            steps {
                dir('web') {
                    sh '''
                        pnpm install --frozen-lockfile
                        pnpm test
                        NEXT_PUBLIC_API_URL=https://burnerbyte.com/api/v1 NEXT_PUBLIC_WS_URL=wss://burnerbyte.com/api/v1/ws pnpm build
                    '''
                }
            }
        }

        stage('Archive') {
            steps {
                sh """
                    mkdir -p dist
                    cp bin/api bin/smtpd dist/
                    cp -r migrations dist/
                    # config.yaml is gitignored/per-deployment; the deploy script
                    # preserves the server's /etc/burnerbyte/config.yaml when the
                    # artifact omits it. Ship the example as a reference.
                    [ -f config.yaml ] && cp config.yaml dist/ || true
                    cp config.example.yaml dist/ 2>/dev/null || true
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
                        scp -i \$SSH_KEY deploy/remote-deploy-hetzner.sh \$SSH_USER@${DEPLOY_HOST}:/tmp/burnerbyte-deploy.sh
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
