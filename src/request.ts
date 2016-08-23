
import Promise = require("bluebird");
import http = require("http");
import https = require("https");

import {Locator, Location, DataExtractor, ReturnedLocation, LocatorFactory} from "./common";
import LocatorException = require("./locatorException");

export interface RequestLocatorParameters {
    url : string;
    dataExtractor? : DataExtractor;
}

export class RequestLocator {
    static getLocatorFactory() : LocatorFactory {
        return function resourceLocator(parameters : any) : Locator {
            if (typeof parameters === "string") {
                parameters = { url : parameters };
            }
            let url : string = parameters.url;
            let request : any;
            if (url.indexOf('http://') === 0) {
                request = http;
            } else if (url.indexOf('https://') === 0) {
                request = https;
            } else {
                throw new Error(`invalid url: ${url}`);
            }

            let dataExtractor : DataExtractor = parameters.dataExtractor ?
                parameters.dataExtractor :
                RequestLocator.DefaultDataExtractor;

            if (!url) {
                throw new Error("must have resource");
            }

            return <Locator>(() => {
                return new Promise<Location>((resolve, reject) => {
                    request.get(url, (res : http.ClientResponse) => {
                        let output : string[] = [];
                        res.setEncoding('utf8');

                        res.on('data', (chunk : string) => {
                            output.push(chunk);
                        });

                        res.on('end', () => {
                            if (200 <= res.statusCode && res.statusCode < 300) {
                                const result = output.join('');
                                resolve(dataExtractor(result));
                            } else {
                                reject(LocatorException.create("BAD_RESPONSE"));
                            }
                        });
                    }).on('error', (err : Error) => {
                        reject(err);
                    });
                });
            });
        };
    };


    static DefaultDataExtractor : DataExtractor = (data : string) : Location => {
        let locations : ReturnedLocation[];
        try {
            locations = JSON.parse(data).servers;
        } catch (e) {
            return null;
        }

        if (!locations) {
            return null;
        }

        const location = locations[Math.floor(Math.random() * locations.length)];

        return {
            host: location.address,
            port: location.port
        };
    };
}
