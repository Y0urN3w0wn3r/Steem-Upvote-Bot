const fs = require("fs");
const steem = require('steem'); // Include Steem Library
const validUrl = require('valid-url'); // Include Valid-URL Library

var account = null;
var trans_number = 0;
var config = null;
var outstanding_votes = [];
var isVoting = false;

// Load the settings from the config file
config = JSON.parse(fs.readFileSync("config.json"));

steem.api.setOptions({ url: config.steem_node }); // Set Steem Node

if (fs.existsSync('state.json')) {
  const state = JSON.parse(fs.readFileSync("state.json"));

  if (state.trans_number) {
      trans_number = state.trans_number;
  }

  console.log("Loaded state.json and set vars");
}

loop();
setInterval(loop, 10000); // Create Loop

function loop() {
     console.log('looping every 10 Seconds'); // Output

    steem.api.getAccounts([config.account_name], function (err, result) { // Get Account Data
        if (err || !result) { // Check for Errors
            console.log('Error loading account: ' + err); // Output Error
            return;
        }

        account = result[0]; // set account
    });

    if (account) {
        steem.api.getAccountHistory(account.name, -1, 50, function (err, result) { // Get last 50 transactions of account
            if (err || !result) { // Check for errors
              console.log('Error loading account history: ' + err); // Output error
              return;
            }

            result.forEach(function(trans) { // Loop through transactions
                var op = trans[1].op; // Get transaction data

                if (trans[0] > trans_number) {
                    if (op[0] == 'transfer' && op[1].to == account.name) { // Check if transaction is transfer TO user account
                        if (validUrl.isUri(op[1].memo)) { // Check if memo contains valid URL
                            var amount = op[1].amount;
                            var currency = amount.substr(amount.indexOf(' ') + 1);
                            amount = parseFloat(amount);

                            if(config.accepted_currencies && config.accepted_currencies.indexOf(currency) < 0) {
                                console.log("INVALID CURRENCY SENT - SHOULD REFUND");
                                refund(op[1].from, op[1].amount, 'invalid_currency');
                            } else if(amount < config.min_bid) {
                                console.log("BID TO LOW - SHOULD REFUND");
                                refund(op[1].from, op[1].amount, 'invalid_bid');
                            } else if (amount > config.max_bid) {
                                console.log("BID TO HIGH - SHOULD REFUND");
                                refund(op[1].from, op[1].amount, 'invalid_bid');
                            } else {
                                checkValidMemo(op, op[1].from, op[1].amount);
                            }
                        } else {
                            console.log("MEMO NOT A URI - SHOULD REFUND");
                            refund(op[1].from, op[1].amount, 'invalid_memo');
                        }
                    }

                    trans_number = trans[0];
                    saveState();
                }
            });
          });

        if (outstanding_votes.length > 0 && !isVoting) {
            sendVotes();
        }
    }
}

function saveState() {
  var state = {
    trans_number: trans_number
  };

  fs.writeFile('state.json', JSON.stringify(state), function (err) {
    if (err) {
        console.log(err);
    }
  });
}

function sendVotes() {
    isVoting = true;
    vote(outstanding_votes.pop(), function() {
        if (outstanding_votes.length > 0) {
            setTimeout(function () { sendVotes(); }, 5000);
        } else {
            isVoting = false;
        }
    })
}

function vote(vote, callback) {
    console.log('Voting: ' + vote);

    steem.broadcast.vote(config.private_posting_key, account.name, vote.author, vote.permlink, 10000, function (err, result) {
        if (err && !result) {
            console.log('Voting failed: ' + err);
            return;
        }

        
        if (callback) {
            callback();
        }
    });
}



function checkValidMemo(transData, sender, amount) {
    if (isVoting) { // Exit early if bot is already voting
        return;
    }

    const memo = transData[1].memo; // Get Memo

    var permLink = memo.substr(memo.lastIndexOf('/') + 1); // Get permLink from memo
    var author = memo.substring(memo.lastIndexOf('@') + 1, memo.lastIndexOf('/')); // get Author from memo

    steem.api.getContent(author, permLink, function (err, result) { // Get Post Data
        if (err || !result) {
            console.log('Not a valid url / author: ' + err); // Post does not exist
            refund(op[1].from, op[1].amount, 'invalid_memo');
            return;
        }

        var created = new Date(result.created + 'Z');
        if ((new Date() - created) >= (config.max_post_age * 60 * 60 * 1000)) {
            console.log('The post is too old for upvoting it!');
            refund(sender, amount, 'post_to_old');
            return;
        }

        var votes = result.active_votes.filter(function(vote) { return vote.voter == account.name; }); // Check if already voted

        if (votes.length > 0 && votes[0].percent > 0) {
            console.log('Already voted on post');
            refund(op[1].from, op[1].amount, 'already_voted');
            return;
        }

        outstanding_votes.push({author: result.author, permlink: result.permlink}); // Add vote to outstanding vote list
    });
}

function refund(sender, amount, memoType) {
  steem.broadcast.transfer(config.private_active_key, config.account_name, sender, amount, config.memo_messages[memoType], function (err, result) {
      if (err || !result) {
          console.log("Refund failed ! For: " + sender);
      }
    });
}
