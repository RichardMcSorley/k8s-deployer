const yaml = require('js-yaml');
const fs = require('fs');
const Client = require('kubernetes-client').Client
const Request = require('kubernetes-client/backends/request')
const JSONStream = require('json-stream')
const Mustache = require('mustache')
const { KUBERNETES_SERVICE_HOST = false } = process.env

function Kube(namespace){
    this.config = KUBERNETES_SERVICE_HOST ? new Request(Request.config.getInCluster()) : new Request(Request.config.fromKubeconfig())
    this.client = new Client({ backend: this.config, version: '1.13' })
    this.namespace = namespace
}

Kube.prototype.subscribe = async function( type, name = null, callback){
    let stream;
    if(name){
        stream = await this.client.apis.apps.v1.watch.namespaces(this.namespace)[type](name).getStream()
    }else{
        stream = await this.client.apis.apps.v1.watch.namespaces(this.namespace)[type].getStream()
    }
    const jsonStream = new JSONStream();
    stream.pipe(jsonStream);
    jsonStream.on('data', callback)
    return stream;
}

Kube.prototype.delete = async function(type, name){
    try {
        await this.client.apis.apps.v1.namespaces(this.namespace)[type](name).delete()
    } catch (err) {
        console.warn(`Unable to delete ${type} ${name}. Skipping.`, err.message)
    }
}

function loadYaml(file){
    return fs.readFileSync(file, 'utf8')
}

function renderJSON(string, view){
    return yaml.safeLoad(Mustache.render(string, view));
}


Kube.prototype.apply = async function (json, type) {
    try {
        await this.client.apis.apps.v1.namespaces(this.namespace)[type].post({ body: json })
        console.log(`Created ${type}`, json.metadata.name)
    } catch (err) {
        console.error('Error: ', err.message)
    }
}



async function main() {
    try {
        const k = new Kube('dev')
        await k.subscribe('deploy', null, (event = {})=>{
            const { object = {} } = event
            const { status = {}, metadata = {} } = object
            const { name } = metadata
            const { conditions = [], ...rest } = status;
            conditions.forEach(({type, status})=>{
                console.log('EVENT:', name, event.type, type, status,'\n',  rest)
            })
        })
        await k.delete('deployment', 'basic-app-deployment')
        const deployment = renderJSON(loadYaml('./basic-app/deployment.yaml'),{
            appName: 'basic-app',
            imageName: 'busybox',
            env: [
                {
                    name: 'ECHO_THIS',
                    value: 'HeLlo WorlD'
                }
            ],
            args: ['env']
        })
        await k.apply(deployment, 'deployment')
    } catch (err) {
        console.error('Error: ', err)
    }
}

main()


setInterval(() => {
    console.log('Cleaning up old apps...')

}, 15 * 60000);