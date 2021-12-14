'use strict'

const agent = require('../../dd-trace/test/plugins/agent')
const plugin = require('../src')
const { setup, sort } = require('./spec_helpers')
const semver = require('semver')

describe('Plugin', () => {
  // TODO: use the Request class directly for generic tests
  // TODO: add test files for every service
  describe('aws-sdk', function () {
    setup()

    withVersions(plugin, 'aws-sdk', (version, ...args) => {
      let AWS
      let s3
      let sqs
      let tracer
      let exactVersion;

      before(() => {
        // AWS = require(`../../../versions/aws-sdk@${version}`).get()
        exactVersion = require(`../../../versions/aws-sdk@${version}`).version()
        console.log('SET EXACTVERSION', exactVersion, version)
      })

      describe('without configuration', () => {
        before(() => {
          AWS = require(`../../../versions/aws-sdk@${version}`).get()
          // exactVersion = require(`../../../versions/aws-sdk@${version}`).version()

          const endpoint = new AWS.Endpoint('http://localhost:4572')

          s3 = new AWS.S3({ endpoint, s3ForcePathStyle: true })
          tracer = require('../../dd-trace')

          return agent.load('aws-sdk')
        })

        after(() => {
          return agent.close()
        })

        it('should instrument service methods with a callback', (done) => {
          agent.use(traces => {
            const span = sort(traces[0])[0]

            expect(span).to.include({
              name: 'aws.request',
              resource: 'listBuckets',
              service: 'test-aws-s3'
            })

            expect(span.meta).to.include({
              'component': 'aws-sdk',
              'aws.region': 'us-east-1',
              'aws.service': 'S3',
              'aws.operation': 'listBuckets'
            })
          }).then(done, done)

          s3.listBuckets(e => e && done(e))
        })

        it('should mark error responses', (done) => {
          let error

          agent.use(traces => {
            const span = sort(traces[0])[0]

            expect(span).to.include({
              name: 'aws.request',
              resource: 'listBuckets',
              service: 'test-aws-s3'
            })

            expect(span.meta).to.include({
              'error.type': error.name,
              'error.msg': error.message,
              'error.stack': error.stack
            })
          }).then(done, done)

          s3.listBuckets({ 'BadParam': 'badvalue' }, e => {
            error = e
          })
        })

        if (semver.satisfies(exactVersion, '>=3.0.0')) {
          console.error('version', exactVersion, args)
          it.only('should instrument methods that go through promisifyMethod', (done) => {
            agent.use(traces => {
              console.error(traces)
              
              const span = sort(traces[0])[0]

              expect(span).to.include({
                name: 'aws.request',
                resource: 'getObject',
                service: 'test-aws-s3'
              })
            }).then(done, done)

            var params = {Bucket: 'bucket', Key: 'key'};
            const promise = s3.getSignedUrlPromise('getObject', params);
            promise.catch(done);
          })
        }
        if (semver.intersects(version, '>=2.3.0')) {
          it('should instrument service methods using promise()', (done) => {
            agent.use(traces => {
              const span = sort(traces[0])[0]

              expect(span).to.include({
                name: 'aws.request',
                resource: 'listBuckets',
                service: 'test-aws-s3'
              })
            }).then(done, done)

            s3.listBuckets().promise().catch(done)
          })

          it('should instrument service methods using promise() with custom promises', (done) => {
            AWS.config.setPromisesDependency(null)

            agent.use(traces => {
              const span = sort(traces[0])[0]

              expect(span).to.include({
                name: 'aws.request',
                resource: 'listBuckets',
                service: 'test-aws-s3'
              })
            }).then(done, done)

            s3.listBuckets().promise().catch(done)
          })
        }

        it('should bind callbacks to the correct active span', (done) => {
          const span = {}

          tracer.scope().activate(span, () => {
            s3.listBuckets(() => {
              try {
                expect(tracer.scope().active()).to.equal(span)
                done()
              } catch (e) {
                done(e)
              }
            })
          })
        })
      })

      describe('with configuration', () => {
        before(() => {
          AWS = require(`../../../versions/aws-sdk@${version}`).get()
          // exactVersion = require(`../../../versions/aws-sdk@${version}`).version()

          const endpoint = new AWS.Endpoint('http://localhost:4572')

          s3 = new AWS.S3({ endpoint, s3ForcePathStyle: true })
          tracer = require('../../dd-trace')

          return agent.load('aws-sdk', {
            service: 'test',
            splitByAwsService: false,
            hooks: {
              request (span, response) {
                span.setTag('hook.operation', response.request.operation)
              }
            }
          })
        })

        after(() => {
          return agent.close()
        })

        it('should be configured', (done) => {
          agent.use(traces => {
            const span = sort(traces[0])[0]

            expect(span).to.include({
              name: 'aws.request',
              resource: 'listBuckets',
              service: 'test'
            })

            expect(span.meta).to.include({
              'hook.operation': 'listBuckets'
            })
          }).then(done, done)

          s3.listBuckets(() => {})
        })
      })

      describe('with service configuration', () => {
        before(() => {
          AWS = require(`../../../versions/aws-sdk@${version}`).get()
          // exactVersion = require(`../../../versions/aws-sdk@${version}`).version()

          s3 = new AWS.S3({ endpoint: new AWS.Endpoint('http://localhost:4572'), s3ForcePathStyle: true })
          sqs = new AWS.SQS({ endpoint: new AWS.Endpoint('http://localhost:4576') })
          tracer = require('../../dd-trace')

          return agent.load('aws-sdk', {
            service: 'test',
            s3: false
          })
        })

        after(() => {
          return agent.close()
        })

        it('should allow disabling a specific service', (done) => {
          let total = 0

          agent.use(traces => {
            const span = sort(traces[0])[0]

            expect(span).to.include({
              name: 'aws.request',
              resource: 'listBuckets',
              service: 'test'
            })

            total++
          }).catch(() => {}, { timeoutMs: 100 })

          agent.use(traces => {
            const span = sort(traces[0])[0]

            expect(span).to.include({
              name: 'aws.request',
              resource: 'listQueues',
              service: 'test'
            })

            total++
          }).catch((e) => {}, { timeoutMs: 100 })

          s3.listBuckets(() => {})
          sqs.listQueues(() => {})

          setTimeout(() => {
            try {
              expect(total).to.equal(1)
              done()
            } catch (e) {
              done(e)
            }
          }, 250)
        })
      })
    })
  })
})
