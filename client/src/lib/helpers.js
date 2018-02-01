import uuid from "uuid";
import Raven from "raven-js";
import URLSearchParams from "url-search-params";

export function checkStatus(response) {
    if (response.status >= 200 && response.status < 300) {
        return response;
    } else {
        let error = new Error(response.statusText);
        error["response"] = response;
        throw error;
    }
}

// outgoingEdges gets edges coming out from the node with the given nodeId in
// given set of edges.
export function outgoingEdges(nodeId, edgeSet) {
    return edgeSet.get({
        filter: function(edge) {
            return edge.from === nodeId;
        },
    });
}

export function isShortestPath(query) {
    return (
        query.indexOf("shortest") !== -1 &&
        query.indexOf("to") !== -1 &&
        query.indexOf("from") !== -1
    );
}

export function showTreeView(query) {
    return (
        query.indexOf("orderasc") !== -1 || query.indexOf("orderdesc") !== -1
    );
}

export function isNotEmpty(response) {
    if (!response) {
        return false;
    }
    let keys = Object.keys(response);
    if (keys.length === 0) {
        return false;
    }

    for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== "extensions" && keys[i] !== "uids") {
            return keys[i].length > 0 && response[keys[i]];
        }
    }
    return false;
}

export function sortStrings(a, b) {
    var nameA = a.toLowerCase(),
        nameB = b.toLowerCase();
    if (
        nameA < nameB // sort string ascending
    )
        return -1;
    if (nameA > nameB) return 1;
    return 0; // default return value (no sorting)
}

export function getEndpointBaseURL(url) {
    return url.url;
}

// getEndpoint returns a URL for the dgraph endpoint, optionally followed by
// path string. Do not prepend `path` with slash.
export function getEndpoint(url, path = "", options = { debug: true }) {
    const baseURL = getEndpointBaseURL(url);
    const fullUrl = `${baseURL}${path}`;

    if (options.debug) {
        return `${fullUrl}?debug=true`;
    }

    return fullUrl;
}

// getShareURL returns a URL for a shared query.
export function getShareURL(url, shareId) {
    const baseURL = getEndpointBaseURL(url);
    return `${baseURL}${shareId}`;
}

export function createCookie(name, val, days, options = {}) {
    let expires = "";
    if (days) {
        let date = new Date();
        date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
        expires = "; expires=" + date.toUTCString();
    }

    let cookie = name + "=" + val + expires + "; path=/";
    if (options.crossDomain) {
        cookie += "; domain=.dgraph.io";
    }

    document.cookie = cookie;
}

export function readCookie(name) {
    let nameEQ = name + "=";
    let ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) === " ") c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0)
            return c.substring(nameEQ.length, c.length);
    }

    return null;
}

export function eraseCookie(name, options) {
    createCookie(name, "", -1, options);
}

export function humanizeTime(time) {
    if (time > 1000) {
        // Time is in ms, lets convert it to seconds for displaying.
        return (time / 1000).toFixed(1) + "s";
    }
    return time.toFixed(0) + "ms";
}

export function serverLatency(latencyObj) {
    var totalLatency = 0;
    // Server returns parsing, processing and encoding latencies in ns separately.
    for (var latency in latencyObj) {
        if (latencyObj.hasOwnProperty(latency)) {
            totalLatency += parseFloat(latencyObj[latency]);
        }
    }

    totalLatency /= Math.pow(10, 6);

    var lat;
    if (totalLatency < 1) {
        lat = Math.round(totalLatency * 1000) + "μs";
    } else if (totalLatency > 1000) {
        lat = Math.round(totalLatency / 1000) + "s";
    } else {
        lat = Math.round(totalLatency) + "ms";
    }
    return lat;
}

// childNodes returns nodes that given edges point to.
export function childNodes(edges) {
    return edges.map(function(edge) {
        return edge.to;
    });
}

/**
 * makeFrame is a factory function for creating frame object
 * IDEA: We could use class with flow if it's not an overkill
 *
 * @params type {String} - type of the frame as defined in the const
 * @params action {String} - action can be query/mutate or alter.
 * @params data {Objecg} - data for the frame
 */
export function makeFrame({ query, action, type, share }) {
    return {
        id: uuid(),
        meta: { collapsed: false },
        type,
        query,
        share,
        action,
    };
}

// CollapseQuery replaces deeply nested blocks in a query with ellipsis.
export function collapseQuery(query) {
    const depthLimit = 3;
    let ret = "";
    let depth = 0;

    for (let i = 0; i < query.length; i++) {
        let char = query[i];

        if (char === "{") {
            depth++;

            if (depth === depthLimit) {
                ret += char;
                ret += " ... ";
                continue;
            }
        } else if (char === "}") {
            depth--;
        }

        if (depth >= depthLimit) {
            continue;
        }

        ret += char;
    }

    return ret;
}

export function executeQuery(url, query, action = "query", debug) {
    var endpoint;

    if (action === "query") {
        endpoint = getEndpoint(url, "query", { debug: debug });
    } else if (action === "mutate") {
        endpoint = getEndpoint(url, "mutate", { debug: false });
    } else if (action === "alter") {
        endpoint = getEndpoint(url, "alter", { debug: false });
    }

    var options = {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        headers: {
            "Content-Type": "text/plain",
        },
        body: query,
    };

    if (action === "mutate") {
        options.headers["X-Dgraph-CommitNow"] = true;
    }

    if (action === "alter") {
        try {
            // DropAll and DropAttr requests are sent through JSON.
            JSON.parse(query);
            options.headers["Content-Type"] = "application/json";
        } catch (e) {}
    }

    return fetch(endpoint, options)
        .then(checkStatus)
        .then(response => response.json());
}

/**
 * getSharedQuery returns a promise that resolves with the query string corresponding
 * to the given shareId. Concretely, it fetches from the database the query
 * stored with the shareId. If not found, the promise resolves with an empty string.
 *
 * @params url {Object}
 * @params shareId {String}
 * @returns {Promise}
 *
 */
export function getSharedQuery(url, shareId) {
    return fetch(getEndpoint(url, "query"), {
        method: "POST",
        mode: "cors",
        headers: {
            Accept: "application/json",
        },
        body: `{
          query(func: uid(${shareId})) {
              _share_
          }
      }`,
    })
        .then(checkStatus)
        .then(response => response.json())
        .then(function(result) {
            if (result.data.query.length > 0 && result.data.query[0]._share_) {
                const query = decodeURI(result.data.query[0]._share_);
                return query;
            } else {
                return "";
            }
        })
        .catch(function(error) {
            Raven.captureException(error);

            console.log(
                `Got error while getting query for id: ${shareId}, err: ${
                    error.message
                }`,
            );
        });
}

export function getDefaultUrl() {
    let url;
    if (window.SERVER_ADDR) {
        url = ensureSlash(window.SERVER_ADDR, false);
    } else {
        let port = ":8080";
        const hostname = window.location.hostname;
        if (hostname !== "localhost" && hostname !== "127.0.0.1") {
            port = window.location.port ? ":" + window.location.port : "";
        }

        url = `${window.location.protocol}//${hostname}${port}`;
    }

    let path = "/";
    const params = new URLSearchParams(window.location.search.slice(1));
    const pathParam = params.get("path");
    if (pathParam) {
        path = ensureSlash(pathParam, true);
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
    }

    return url + path;
}

export function updateUrlOnStartup() {
    return !window.SERVER_ADDR;
}

export function processUrl(url) {
    // Add http if a scheme is not specified.
    if (!/^[a-zA-Z][a-zA-Z+.-]*?:\/\//i.test(url)) {
        url = "http://" + url;
    }

    const parser = document.createElement("a");
    parser.href = url;

    // Required for IE.
    if (!parser.host) {
        parser.href = parser.href;
    }

    return ensureSlash(
        `${parser.protocol}//${parser.host}${parser.pathname}`,
        true,
    );
}

export function ensureSlash(path, needsSlash) {
    const hasSlash = path.endsWith("/");
    if (hasSlash && !needsSlash) {
        return path.substr(path, path.length - 1);
    } else if (!hasSlash && needsSlash) {
        return `${path}/`;
    } else {
        return path;
    }
}
