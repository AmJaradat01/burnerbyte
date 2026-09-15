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
        // Baked into the frontend bundle at build time, so they must be the
        // public URLs of the target deployment, not localhost.
        PUBLIC_API_URL  = 'https://burnerbyte.com'
        PUBLIC_WS_URL   = 'wss://burnerbyte.com'
        PUBLIC_SITE_URL = 'https://burnerbyte.com'
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
                sh '''
                    # Apply migrations before the integration tests. This used to be
                    # "|| true", which let the suite run against a stale schema and
                    # report a missing column as a code fault.
                    TEST_DB="${TEST_DATABASE_URL:-postgres://postgres:password@localhost:5432/burnerbyte_test?sslmode=disable}"
                    command -v migrate >/dev/null || {
                        echo "golang-migrate is not installed on this agent; integration tests need it."
                        echo "Install: https://github.com/golang-migrate/migrate (the deploy scripts pin v4.18.3)"
                        exit 1
                    }
                    migrate -database "$TEST_DB" -path migrations up
                    go vet ./...
                    go test -race ./...
                '''
            }
        }

        stage('Build Go') {
            steps {
                sh '''
                    go version
                    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-X main.Version=${TAG}" -o bin/api ./cmd/api
                    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-X main.Version=${TAG}" -o bin/smtpd ./cmd/smtpd
                '''
            }
        }

        stage('Test & Build Frontend') {
            steps {
                dir('web') {
                    sh '''
                        pnpm install --frozen-lockfile
                        pnpm lint
                        pnpm typecheck
                        pnpm test
                        NEXT_PUBLIC_API_URL="${PUBLIC_API_URL}/api/v1" \
                        NEXT_PUBLIC_WS_URL="${PUBLIC_WS_URL}/api/v1/ws" \
                        NEXT_PUBLIC_SITE_URL="${PUBLIC_SITE_URL}" \
                        pnpm build
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
