import Client from 'ssh2-sftp-client'
import Server from 'node-sftp-server'
import fs from 'fs'

describe('node sftp server', () => {
    const createServer = () => {
        const server = new Server({
            privateKeyFile: 'id_rsa'
        })

        server.listen(8022)

        // Todo, use a `tmp` directory and seed the files!
        const basePath = `${__dirname}/files`

        server.on('connect', (auth: any, info: any) => {
            console.warn(
                'authentication attempted, client info is: ' + JSON.stringify(info) + ', auth method is: ' + auth.method
            )
            const username = auth.username
            const password = auth.password

            console.log('username', username)
            console.log('password', password)
            if (
                auth.method !== 'password' ||
                auth.username !== 'user' ||
                auth.password !== 'asdf' // Todo, just allow everything?
            ) {
                return auth.reject(['password'], false)
            }
            console.warn("We haven't *outhright* accepted yet...")

            return auth.accept((session: any) => {
                console.warn("Okay, we've accepted, allegedly?")
                session.on('stat', (path: any, statkind: any, statresponder: any) => {
                    try {
                        const stats = fs.statSync(`${basePath}/${path}`)

                        if (stats.isDirectory()) {
                            statresponder.is_directory() // Tells statresponder that we're describing a directory.
                        } else {
                            statresponder.is_file()
                        }

                        statresponder.permissions = (stats.mode & 0o777).toString(8)
                        statresponder.uid = stats.uid // User ID that owns the file.
                        statresponder.gid = stats.gid // Group ID that owns the file.
                        statresponder.size = stats.size // File size in bytes.
                        statresponder.atime = stats.atime // Created at (unix style timestamp in seconds-from-epoch).
                        statresponder.mtime = stats.mtime // Modified at (unix style timestamp in seconds-from-epoch).

                        statresponder.file() // Tells the statter to actually send the values above down the wire.
                    } catch (error) {
                        console.error(error)
                        statresponder.nofile()
                    }
                })
                session.on('realpath', (path: any, callback: any) => {
                    console.log('realpath()', path)

                    let newPath = path

                    if (!path.startsWith('/')) {
                        newPath = '/' + path
                    }

                    callback(newPath)
                })
                session.on('readdir', (path: any, responder: any) => {
                    console.warn('Readdir request for path: ' + path)
                    try {
                        const files = fs.readdirSync(`${basePath}${path}`)
                        let i = 0
                        responder.on('dir', () => {
                            const file = files[i]
                            if (file) {
                                console.log('Listing file', file)
                                const stats: any = fs.statSync(`${basePath}${path}/${file}`)
                                if (stats.isDirectory()) {
                                    stats.type = fs.constants.S_IFDIR
                                } else {
                                    stats.type = fs.constants.S_IFREG
                                }
                                stats.permissions = (stats.mode & 0o777).toString(8)
                                responder.file(file, stats)
                                return i++
                            }
                            return responder.end()
                        })
                        return responder.on('end', () => {
                            return console.warn(
                                'Now I would normally do, like, cleanup stuff, for this directory listing'
                            )
                        })
                    } catch (error) {
                        console.error(error)
                        return responder.end()
                    }
                })
                session.on('readfile', (path: any, writestream: any) => {
                    console.log('read file', path)
                    return fs.createReadStream(`${basePath}${path}`).pipe(writestream)
                })
                return session.on('writefile', (path: any, readstream: any) => {
                    console.warn('WRITE FILE HAS BEEN ATTEMPTED!')
                    const something = fs.createWriteStream(`${basePath}${path}`)
                    readstream.on('end', () => {
                        console.warn('Writefile request has come to an end!!!')
                    })
                    return readstream.pipe(something)
                })
            })
        })

        return server
    }

    it('Can list files', async () => {
        const client = new Client()

        const server = createServer()

        let errored = false

        try {
            await client.connect({
                host: '127.0.0.1',
                port: 8022,
                username: 'user',
                password: 'asdf'
            })
            let data = await client.list('/')
            expect(data[0].name).toBe('nested')
            expect(data[0].size).toBe(4096)
            expect(data[1].name).toBe('test.txt')
            expect(data[1].size).toBe(12)

            data = await client.list('/nested')
            expect(data[0].name).toBe('another.txt')
            expect(data[0].size).toBe(9)

            let contents = await client.get('/nested/another.txt')
            expect(contents.toString()).toBe('some data')

            const putData = fs.createReadStream(`${__dirname}/files/test.txt`)
            await client.put(putData, '/nested/new.txt')
            contents = await client.get('/nested/new.txt')
            expect(contents.toString()).toBe('I have data!')
        } catch (error) {
            console.error(error)
            errored = true
        } finally {
            await client.end()
            await server.close()
        }

        expect(errored).toBe(false)
    })
})
