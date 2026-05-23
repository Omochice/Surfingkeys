import {
    createElementWithContent,
    showBanner,
    showPopup,
} from '../common/utils.js';
import { RUNTIME } from '../common/runtime.js';

export default (normal, command, omnibar) => {
    command('setProxy', 'setProxy <proxy_host>:<proxy_port> [proxy_type|PROXY]', function(args) {
        // args is an array of arguments
        var proxy = ((args.length > 1) ? args[1] : "PROXY") + " " + args[0];
        RUNTIME('updateProxy', {
            proxy: proxy
        });
        return true;
    });

    command('setProxyMode', 'setProxyMode <always|direct|byhost|system|clear>', function(args) {
        RUNTIME("updateProxy", {
            mode: args[0]
        }, function(rs) {
            if (["byhost", "always"].indexOf(rs.proxyMode) !== -1) {
                showBanner("{0}: {1}".format(rs.proxyMode, rs.proxy), 3000);
            } else {
                showBanner(rs.proxyMode, 3000);
            }
        });
        // return true to close Omnibar for Commands, false to keep Omnibar on
        return true;
    });

    command('feedkeys', 'feed mapkeys', function(args) {
        normal.feedkeys(args[0]);
    });
    command('quit', '#5quit chrome', function() {
        RUNTIME('quit');
    });
    command('clearHistory', 'clearHistory <find|cmd|...>', function(args) {
        let update = {};
        update[args[0]] = [];
        RUNTIME('updateInputHistory', update);
    });
    command('listSession', 'list session', function() {
        RUNTIME('getSettings', {
            key: 'sessions'
        }, function(response) {
            omnibar.listResults(Object.keys(response.settings.sessions), function(s) {
                return createElementWithContent('li', s);
            });
        });
    });
    command('createSession', 'createSession [name]', function(args) {
        RUNTIME('createSession', {
            name: args[0]
        });
    });
    command('deleteSession', 'deleteSession [name]', function(args) {
        RUNTIME('deleteSession', {
            name: args[0]
        });
        return true; // to close omnibar after the command executed.
    });
    command('openSession', 'openSession [name]', function(args) {
        RUNTIME('openSession', {
            name: args[0]
        });
    });
    command('listQueueURLs', 'list URLs in queue waiting for open', function(args) {
        RUNTIME('getQueueURLs', null, function(response) {
            omnibar.listResults(response.queueURLs, function(s) {
                return createElementWithContent('li', s);
            });
        });
    });
    command('clearQueueURLs', 'clear URLs in queue waiting for open', function(args) {
        RUNTIME('clearQueueURLs');
    });
    command('createTabGroup', 'group all tabs by domain: createTabGroup [title] [grey|blue|red|yellow|green|pink|purple|cyan|orange]', function(args) {
        RUNTIME('createTabGroup', {title: args[0], color: args[1]});
    });
    command('timeStamp', 'print time stamp in human readable format', function(args) {
        var dt = new Date(parseInt(args[0]));
        omnibar.listWords([dt.toString()]);
    });
}
