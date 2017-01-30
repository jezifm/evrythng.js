/* eslint-env jasmine */
import fetchMock from 'fetch-mock'
import apiUrl from '../helpers/apiUrl'
import settings from '../../src/settings'
import setup from '../../src/setup'
import api from '../../src/api'

let request
const response = {
  id: 'testId',
  name: 'Foobar'
}
const error = {
  status: 400,
  body: {
    status: 400,
    errors: ['error']
  }
}

// Copy initial settings
const initialSettings = Object.assign({}, settings)

describe('api', () => {
  beforeAll(() => {
    fetchMock.mock(apiUrl('/error'), Object.assign({}, error))
    fetchMock.mock('*', Object.assign({}, response))
  })
  afterAll(fetchMock.restore)

  afterEach(done => {
    setup(initialSettings)
    request.then(done).catch(done)
  })

  describe('options', () => {
    describe('defaults', () => {
      it('should have default url and method', () => {
        request = api().then(() => {
          expect(fetchMock.lastUrl()).toEqual(apiUrl())
          expect(fetchMock.lastOptions().method).toEqual('get')
        })
      })
    })

    describe('global settings', () => {
      it('should merge defaults with global settings', () => {
        request = api().then(() => {
          const headers = fetchMock.lastOptions().headers
          expect(headers['content-type']).toBeDefined()
          expect(headers['content-type']).toEqual('application/json')
        })
      })

      it('should use global settings after change', () => {
        setup({
          headers: { 'content-type': 'text/plain' }
        })
        request = api().then(() => {
          const headers = fetchMock.lastOptions().headers
          expect(headers['content-type']).toBeDefined()
          expect(headers['content-type']).toEqual('text/plain')
        })
      })
    })

    describe('custom options', () => {
      it('should merge custom options', () => {
        const method = 'post'
        request = api({ method }).then(() => {
          expect(fetchMock.lastOptions().method).toEqual(method)
        })
      })

      it('should merge nested headers', () => {
        const headers = {
          'content-type': 'text/plain',
          'accept': 'application/json'
        }
        request = api({ headers }).then(() => {
          expect(fetchMock.lastOptions().headers['content-type'])
            .toEqual(headers['content-type'])
          expect(fetchMock.lastOptions().headers.accept)
            .toEqual(headers.accept)
        })
      })

      it('should user apiKey if authorization header not provided', () => {
        const apiKey = 'apiKey'
        request = api({ apiKey }).then(() => {
          expect(fetchMock.lastOptions().headers.authorization).toEqual(apiKey)
        })
      })
    })

    describe('interceptors', () => {
      const requestSpy = jasmine.createSpy('request')
      const responseSpy = jasmine.createSpy('response')
      const loggerInterceptor = {
        request: requestSpy,
        response: responseSpy
      }
      const mutatorInterceptor = {
        request (options) {
          options.headers.accept = 'application/json'
          options.method = 'post'
          return options
        },
        response (res) {
          // assuming fullResponse: false
          res.foo = 'bar'
          return res
        }
      }
      const incrementInterceptor = {
        request (options) {
          options.body = options.body || { count: 0 }
          options.body.count++
          return options
        },
        response (res) {
          // assuming fullResponse: false
          res.count = res.count || 0
          res.count ++
          return res
        }
      }
      const asyncIncrementInterceptor = {
        request (options) {
          return new Promise(resolve => {
            setTimeout(() => {
              options.body = options.body || { count: 0 }
              options.body.count++
              resolve(options)
            }, 10)
          })
        },
        response (res) {
          // assuming fullResponse: false
          return new Promise(resolve => {
            setTimeout(() => {
              res.count = res.count || 0
              res.count++
              resolve(res)
            }, 10)
          })
        }
      }
      const cancelInterceptor = {
        request (options, cancel) {
          cancel()
        }
      }
      const asyncCancelInterceptor = {
        request (options, cancel) {
          return new Promise(resolve => {
            setTimeout(() => {
              cancel()
              resolve()
            }, 10)
          })
        }
      }
      const rejectInterceptor = {
        response () {
          throw new Error('Rejected')
        }
      }
      const monkeyPatchInterceptor = {
        response (res) {
          const json = res.json
          res.json = function () {
            return json.apply(this, arguments).then(j => {
              j.foo = 'bar'
              return j
            })
          }
          return res
        }
      }

      beforeEach(() => {
        requestSpy.calls.reset()
        responseSpy.calls.reset()
        fetchMock.reset()
      })

      describe('request interceptors', () => {
        it('should run before request', () => {
          const interceptors = [loggerInterceptor]
          request = api({ interceptors }).then(() => {
            expect(requestSpy).toHaveBeenCalled()
            expect(requestSpy.calls.mostRecent().args[0]).toEqual(
              jasmine.objectContaining({
                method: 'get'
              })
            )
          })
        })

        it('should be able to mutate request options', () => {
          const interceptors = [mutatorInterceptor]
          request = api({ interceptors }).then(() => {
            expect(fetchMock.lastOptions().method).toEqual('post')
            expect(fetchMock.lastOptions().headers.accept)
              .toEqual('application/json')
          })
        })

        it('should use previous options if interceptor does not return', () => {
          const interceptors = [loggerInterceptor]
          request = api({ interceptors }).then(() => {
            expect(fetchMock.lastOptions().method).toEqual('get')
          })
        })

        it('should allow multiple interceptors that run in order', () => {
          const interceptors = [incrementInterceptor, incrementInterceptor]
          request = api({ interceptors }).then(() => {
            expect(fetchMock.lastOptions().body).toBeDefined()
            expect(fetchMock.lastOptions().body.count).toEqual(2)
          })
        })

        it('should allow async interceptors (return promises)', () => {
          const interceptors = [
            asyncIncrementInterceptor,
            asyncIncrementInterceptor
          ]
          request = api({ interceptors }).then(() => {
            expect(fetchMock.lastOptions().body).toBeDefined()
            expect(fetchMock.lastOptions().body.count).toEqual(2)
          })
        })

        it('should be able to cancel requests', () => {
          const interceptors = [cancelInterceptor]
          request = api({ interceptors }).catch(err => {
            expect(err.cancelled).toBe(true)
            expect(fetchMock.called()).toBe(false)
          })
        })

        it('should be able to cancel request from async interceptor', () => {
          const interceptors = [asyncCancelInterceptor]
          request = api({ interceptors }).catch(err => {
            expect(err.cancelled).toBe(true)
            expect(fetchMock.called()).toBe(false)
          })
        })

        it('should not run interceptors after request is cancelled', () => {
          const interceptors = [cancelInterceptor, loggerInterceptor]
          request = api({ interceptors }).catch(() => {
            expect(requestSpy).not.toHaveBeenCalled()
            expect(fetchMock.called()).toBe(false)
          })
        })

        it('should cancel the right request', () => {
          const firstRequest = api({ interceptors: [asyncCancelInterceptor] })
            .then(() => expect(true).toBe(false)) // should not get here

          const secondRequest = api({ interceptors: [loggerInterceptor] })
            .catch(() => expect(true).toBe(false)) // should not get here

          request = Promise.all([firstRequest, secondRequest])
        })
      })

      describe('response interceptors', () => {
        it('should run after the response', () => {
          const interceptors = [loggerInterceptor]
          request = api({ interceptors }).then(() => {
            expect(responseSpy).toHaveBeenCalled()
            expect(responseSpy).toHaveBeenCalledWith(response)
          })
        })

        it('should be able to mutate simple response', () => {
          const interceptors = [mutatorInterceptor]
          request = api({ interceptors }).then(res => {
            expect(res.id).toBeDefined()
            expect(res.id).toEqual(response.id)
            expect(res.foo).toBeDefined()
            expect(res.foo).toEqual('bar')
          })
        })

        it('should allow multiple interceptors that run in order', () => {
          const interceptors = [incrementInterceptor, incrementInterceptor]
          request = api({ interceptors }).then(res => {
            expect(res.count).toBeDefined()
            expect(res.count).toEqual(2)
          })
        })

        it('should allow async interceptors (return promises)', () => {
          const interceptors = [
            asyncIncrementInterceptor,
            asyncIncrementInterceptor
          ]
          request = api({ interceptors }).then(res => {
            expect(res.count).toBeDefined()
            expect(res.count).toEqual(2)
          })
        })

        it('should allow to reject a successful response', () => {
          const interceptors = [rejectInterceptor]
          request = api({ interceptors })
            .then(() => expect(true).toBe(false)) // should not get here
        })

        it('should allow monkey patch of full responses', () => {
          const interceptors = [monkeyPatchInterceptor]
          request = api({ interceptors, fullResponse: true })
            .then(res => res.json())
            .then(res => {
              expect(res.foo).toBeDefined()
              expect(res.foo).toEqual('bar')
            })
        })
      })
    })

    describe('fetch', () => {
      it('should join url with apiUrl', () => {
        const customOptions = {
          apiUrl: 'https://api-test.evrythng.net',
          url: '/thngs'
        }
        request = api(customOptions).then(() => {
          expect(fetchMock.lastUrl())
            .toEqual(`${customOptions.apiUrl}${customOptions.url}`)
        })
      })

      it('should build url with params options', () => {
        const params = {
          foo: 'bar'
        }
        request = api({ params }).then(() => {
          expect(fetchMock.lastUrl()).equal(apiUrl('?foo=bar'))
        })
      })

      it('should allow body with FormData', () => {
        const form = new FormData()
        form.append('foo', 'bar')
        request = api({ body: form }).then(() => {
          expect(fetchMock.lastOptions().body).toEqual(form)
          expect(fetchMock.lastOptions().headers['content-type'])
        })
      })
    })

    describe('handle response', () => {
      it('should return json body by default', () => {
        request = api({ url: '/thngs' }).then(res => {
          expect(res).toEqual(response)
        })
      })

      it('should reject on HTTP error code', function () {
        request = api({ url: '/error' })
          .then(() => expect(true).toBe(false)) // should not get here
          .catch(res => expect(res).toEqual(error.body))
      })

      it('should return full Response object with fullResponse option', () => {
        request = api({ fullResponse: true }).then(res => {
          expect(res instanceof Response).toBe(true)
          expect(res.headers).toBeDefined()
          expect(res.ok).toBe(true)

          return res.json().then(body => {
            expect(body).toEqual(response)
          })
        })
      })

      it('should return full Response object even on HTTP error code', function () {
        request = api({
          url: '/error',
          fullResponse: true
        })
          .then(() => expect(true).toBe(false)) // should not get here
          .catch(res => {
            expect(res instanceof Response).toBe(true)
            expect(res.ok).toBe(false)

            return res.json().then(body => {
              expect(body).toEqual(error.body)
            })
          })
      })
    })

    describe('callbacks', () => {
      const callbackSpy = jasmine.createSpy('callback')

      beforeEach(callbackSpy.calls.reset)

      it('should call callback without error on success', () => {
        request = api({ url: '/thngs' }, callbackSpy).then(() => {
          expect(callbackSpy).toHaveBeenCalledWith(null, response)
        })
      })

      it('should call callback with error on error', () => {
        request = api({ url: '/error' }, callbackSpy)
          .catch(() => expect(callbackSpy).toHaveBeenCalledWith(error.body))
      })
    })
  })
})