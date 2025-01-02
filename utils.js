import fetch from "node-fetch";
import { config } from "dotenv";
import fs from "fs";
import fastcsv from "fast-csv";
import { promisify } from "util";
import DbService from "./db/index.js"; // Ensure DbService is imported correctly

config();
const ADDRESS = "https://public-api.dextools.io/trial/v2";
const TOKEN = process.env.DEXTOOLS_API_KEY || process.env.DEXTOOLS_TOKEN || "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Convert JSON data to CSV and send it as a Telegram document

export const convertJsonToCsv = async (data, filePath, ctx) => {
  if (data.length === 0) {
    console.log("No data to write to CSV.");
    return;
  }

  // Log data before attempting to write to CSV
  console.log("Data to write to CSV:", JSON.stringify(data, null, 2));

  // Flatten the data to ensure nested fields like 'socials' are correctly processed
  // const flattenedData = data.map((item) => ({
  //   pool: item.pool,
  //   token0: item.token0,
  //   token1: item.token1,
  //   liquidity: item.liquidity,
  //   telegram: item.socials.telegram || "N/A",
  //   discord: item.socials.discord || "N/A",
  //   twitter: item.socials.twitter || "N/A",
  // }));
  const flattenedData = data;

  // Log flattened data to check if it's in a good format
  console.log(
    "Flattened Data to write to CSV:",
    JSON.stringify(flattenedData, null, 2)
  );

  // Ensure directory exists and the file can be written
  try {
    const dir = filePath.split("/").slice(0, -1).join("/");
    if (!fs.existsSync(dir) && dir !== "") {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (error) {
    console.error("Error ensuring directory exists:", error);
    return;
  }

  // Create a writable stream for the CSV file
  const ws = fs.createWriteStream(filePath);

  // Wrap the fastcsv write stream in a promise to handle the finish event
  const writeCsvPromise = new Promise((resolve, reject) => {
    const csvStream = fastcsv
      .write(flattenedData, { headers: true })
      .on("finish", () => {
        console.log("CSV file created successfully.");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error writing to CSV:", err);
        reject(err);
      });

    // Pipe the data to the writable stream
    console.log("Piping data to the file...");
    csvStream.pipe(ws);
  });

  try {
    // Wait for the CSV writing process to finish
    await writeCsvPromise;

    // Log that the stream has finished
    console.log("CSV stream finished and closed.");

    // Explicitly flush the file stream to ensure data is written before we move on
    ws.end(); // Explicitly end the stream here

    // Check the file content
    fs.readFile(filePath, "utf8", (err, content) => {
      if (err) {
        console.error("Error reading CSV file:", err);
      } else {
        console.log("File content:", content);
      }
    });

    // Send the CSV file to Telegram if data is available
    if (ctx) {
      try {
        await ctx.replyWithDocument({ source: filePath });
        console.log("CSV file sent successfully.");
      } catch (error) {
        console.error("Error sending CSV file via Telegram:", error);
      }
    }
  } catch (error) {
    console.error("Error during CSV writing process:", error);
  }
};

// Get blockchain parameters based on network and version
const getBlockchainParams = (network, version) => {
  let params = {
    network: "",
    contractAddress: "",
    slug: "",
  };
  switch (network) {
    case "bsc":
      params.slug = "bsc";
      params.network = "bsc";
      params.contractAddress =
        version === "v2"
          ? "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"
          : "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7";
      break;
    case "base":
      params.slug = "base";
      params.network = "base";
      params.contractAddress =
        version === "v2"
          ? "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"
          : "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
      break;
    case "polygon":
      params.slug = "polygon";
      params.network = "matic";
      params.contractAddress =
        version === "v2"
          ? "0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C"
          : "0x1F98431c8aD98523631AE4a59f267346ea31F984";
      break;
    default:
      break;
  }
  return params;
};

// Get provider parameters for a given chain and pool
// const getProviderParams = (chain, pool) => {
//   return {
//     url: `https://api.dexscreener.com/latest/dex/pairs/${chain.slug}/${pool}`,
//     headers: {},
//   };
// };

// Fetch social data from CoinMarketCap
const fetchFromCMC = async (pair) => {
  try {
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/info?address=${pair}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY },
    });
    const data = await response.json();
    if (data.status.error_code === 0) {
      const key = Object.keys(data.data)[0];
      return {
        telegram: data.data[key]?.urls?.chat || "N/A",
        discord: data.data[key]?.urls?.discord || "N/A",
        twitter: data.data[key]?.urls?.twitter || "N/A",
      };
    }
  } catch (error) {
    console.error(`Error fetching socials from CMC for pair ${pair}:`, error);
  }
  return {
    telegram: "N/A",
    discord: "N/A",
    twitter: "N/A",
  };
};

// Fetch social data from DexTools
// const fetchFromDEXTools = async (address, network) => {
//   try {
//     const url = `https://public-api.dextools.io/trial/v2/token/${network}/${address}`;
//     const response = await fetch(url, {
//       method: "GET",
//       headers: { "x-api-key": process.env.DEXTOOLS_API_KEY },
//     });

//     if (response.status === 429) {
//       console.log("Rate limit exceeded. Retrying...");
//       await sleep(60000); // Sleep for 1 minute
//       return fetchFromDEXTools(address, network); // Retry
//     }

//     if (response.status === 404) {
//       console.error(`Token not found for address ${address} on ${network}`);
//       return { telegram: "N/A", discord: "N/A", twitter: "N/A" };
//     }

//     const data = await response.json();
//     if (data?.data?.socialInfo) {
//       return {
//         telegram: data.data.socialInfo.telegram || "N/A",
//         discord: data.data.socialInfo.discord || "N/A",
//         twitter: data.data.socialInfo.twitter || "N/A",
//       };
//     }
//   } catch (error) {
//     console.error(
//       `Error fetching socials from DexTools for address ${address}:`,
//       error
//     );
//   }

//   return { telegram: "N/A", discord: "N/A", twitter: "N/A" };
// };

// Combine social data from CMC and DEXTools
// const getPairSocials = async (pair) => {
//   try {
//     const [cmcSocials, dextoolsSocials] = await Promise.all([
//       fetchFromCMC(pair),
//       fetchFromDEXTools(pair),
//     ]);

//     return {
//       telegram:
//         dextoolsSocials.telegram !== "N/A"
//           ? dextoolsSocials.telegram
//           : cmcSocials.telegram,
//       discord:
//         dextoolsSocials.discord !== "N/A"
//           ? dextoolsSocials.discord
//           : cmcSocials.discord,
//       twitter:
//         dextoolsSocials.twitter !== "N/A"
//           ? dextoolsSocials.twitter
//           : cmcSocials.twitter,
//     };
//   } catch (error) {
//     console.error(`Error fetching socials for pair ${pair}:`, error);
//     return { telegram: "N/A", discord: "N/A", twitter: "N/A" };
//   }
// };

// Save pool data to the database
const savePoolDataToDb = async (validTokens) => {
  try {
    const filteredTokens = validTokens.filter((token) => {
      return (
        token &&
        token.pool &&
        token.token0 &&
        token.token1 &&
        token.liquidity &&
        token.socials
      );
    });

    if (filteredTokens.length > 0) {
      await DbService.insertAll(filteredTokens, "pools");
      console.log("Pool data saved to the database successfully.");
    } else {
      console.log("No valid tokens to save.");
    }
  } catch (error) {
    console.error("Error saving pool data to the database:", error);
  }
};

// Process token info and filter valid tokens
// const getTokenInfo = async (chain, pools, ctx) => {
//   const stableCoins = [
//     "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // ETH
//     "0x55d398326f99059ff775485246999027b3197955", // USDT
//     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
//     "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
//     "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
//     "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT (Polygon)
//     "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC (Polygon)
//     "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH (Polygon)
//     "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // FDUSD
//   ];

//   const validTokens = [];
//   const concurrencyLimit = 50;
//   const poolChunks = [];

//   // Split pools into chunks for concurrent processing
//   for (let i = 0; i < pools.length; i += concurrencyLimit) {
//     poolChunks.push(pools.slice(i, i + concurrencyLimit));
//   }

//   let startTime = Date.now();

//   // Process pools in chunks
//   for (let i = 0; i < poolChunks.length; i++) {
//     const chunk = poolChunks[i];
//     console.log(`Processing batch ${i + 1}/${poolChunks.length}...`);

//     const results = await Promise.all(
//       chunk.map(async (pool) => {
//         const provider = getProviderParams(chain, pool.pair);
//         try {
//           const response = await fetch(provider.url, {
//             headers: provider.headers,
//           });
//           const data = await response.json();

//           if (!data.pair || !data.pair.liquidity) {
//             console.log(`No liquidity data for pool ${pool.pair}`);
//             return null;
//           }

//           const liquidity = data.pair.liquidity.usd || 0;

//           // Log liquidity data for debugging
//           console.log(`Liquidity for pool ${pool.pair}: ${liquidity}`);

//           if (liquidity > 10) {
//             // Identify the base token (the native token, not a stable coin)
//             const baseToken = stableCoins.includes(pool.token0)
//               ? pool.token1
//               : pool.token0;

//             // Fetch social data only for the base/native token from the correct network
//             const socials = await fetchFromDEXTools(baseToken, chain.slug); // Ensure correct network (BSC, Polygon, Base)

//             // Log the social data for debugging
//             console.log(`Social data for pool ${pool.pair}:`, socials);

//             // Return only if valid social data exists (non-"N/A" fields)
//             if (socials.telegram !== "N/A") {
//               return {
//                 pool: pool.pair,
//                 token0: pool.token0,
//                 token1: pool.token1,
//                 liquidity,
//                 socials,
//               };
//             } else {
//               console.log(`Missing Telegram social data for pool ${pool.pair}`);
//               return null;
//             }
//           } else {
//             console.log(`Pool ${pool.pair} skipped due to liquidity < 10 USD.`);
//             return null;
//           }
//         } catch (error) {
//           console.error(`Error fetching data for pool ${pool.pair}:`, error);
//           return null;
//         }
//       })
//     );

//     // Filter out null results (failed pools)
//     const filteredResults = results.filter((result) => result !== null);
//     validTokens.push(...filteredResults);

//     // Estimate remaining time based on processing speed
//     if (i === 0 && poolChunks.length > 1) {
//       const endTime = Date.now();
//       const timeTaken = endTime - startTime;
//       const estimatedTimeRemaining =
//         ((poolChunks.length - 1) * timeTaken) / 1000;

//       await ctx.reply(
//         `First batch processed. Estimated time remaining for this index: ~${Math.ceil(
//           estimatedTimeRemaining / 60
//         )} minutes.`
//       );
//     }

//     console.log(`Processed ${validTokens.length} valid pools so far.`);
//     await sleep(2000); // Delay to avoid rate-limiting
//   }

//   // If valid tokens are found, proceed with CSV creation
//   if (validTokens.length > 0) {
//     console.log(`Total valid pools found: ${validTokens.length}`);
//     const filePath = "./valid_tokens.csv";
//     await convertJsonToCsv(validTokens, filePath, ctx);
//     await savePoolDataToDb(validTokens); // Save to the database after processing
//   } else {
//     console.log("No valid tokens found to process.");
//   }
// };

const makeRequest = async (url) => {
  console.log("make request url::", url);
  const retries = 3;
  try {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-API-KEY": TOKEN,
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();
      // console.log("token data", data.data);
      if (data) {
        break;
      } else {
        console.log("request data is failed..");
        await sleep(600);
      }
    }
    if (data) return data.data;
  } catch (error) {
    throw error;
  }
};

const fetchPoolsBetweenDates = async (chain, startDate, endDate) => {
  let currentDate = new Date(startDate);
  endDate = new Date(endDate);

  const totalResults = []; // To store accumulated results

  // Loop through each day in the date range
  while (currentDate <= endDate) {
    const from = currentDate.toISOString();
    const to = new Date(currentDate);
    to.setUTCDate(currentDate.getUTCDate() + 1); // Move to the next day
    const endpointUrl = `${ADDRESS}/pool/${chain}?sort=creationTime&order=asc&from=${from}&to=${to.toISOString()}&pageSize=50`;

    try {
      const results = await fetchAllResults(endpointUrl);
      totalResults.push(...results); // Combine results from all pages
      currentDate.setUTCDate(currentDate.getUTCDate() + 1); // Move to the next day
    } catch (error) {
      console.error(
        `Error fetching data from ${from} to ${to.toISOString()}:`,
        error.message
      );
    }
    await sleep(1000);
  }
  return totalResults; // Return combined results
};

// Helper function to fetch all results from a given URL
const fetchAllResults = async (url) => {
  let results = [];
  let page = 0;
  let totalPages;
  // console.log("fetchResult==>", url);
  const retries = 3;

  do {
    try {
      for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(`${url}&page=${page}`, {
          method: "GET",
          headers: {
            "X-API-KEY": TOKEN,
            "Content-Type": "application/json",
          },
        });

        const data = await response.json();

        if (data.statusCode === 200) {
          // Extract results and total pages
          // console.log("data==>", data);

          const { totalPages: tp, results: pageResults } = data.data;
          totalPages = tp;
          // console.log(tp);
          results.push(...pageResults);
          break;
        } else {
          console.error(`Received unexpected status code ${data.statusCode}`);
          await sleep(600);
        }
      }
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error.message);
    }

    page++;
    await sleep(1000);
  } while (page <= totalPages);

  return results;
};

// Helper function to extract token addresses
const extractTokenAddresses = async (allPools, version, chain) => {
  const stableCoins = [
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // ETH
    "0x55d398326f99059ff775485246999027b3197955", // USDT
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
    "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // USDT (Polygon)
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC (Polygon)
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH (Polygon)
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // FDUSD
  ];
  const poolData = [];
  console.log("all Pools length==>", allPools.length);
  for (const pool of allPools) {
    const exchangeName = pool.exchange?.name;
    const versonName = version === "v2" ? "Uniswap V2" : "Uniswap V3";
    if (exchangeName === versonName) {
      // console.log(pool);
      const poolAddress = pool.address;
      const liquidity = await getLiquidity(chain, poolAddress);
      console.log("liquidity==>", liquidity);
      await sleep(500);
      if (liquidity > 10) {
        const mainTokenAddress = pool.mainToken?.address;
        const sideTokenAddress = pool.sideToken?.address;

        const baseToken = stableCoins.includes(mainTokenAddress)
          ? sideTokenAddress
          : mainTokenAddress;
        const tgInfo = await getSocialInfo(chain, baseToken);
        console.log("tg info ==>", tgInfo);
        const tokenInfo = await getDSinfo(baseToken);
        console.log("Token info from Dexscreener", tokenInfo);
        if (tgInfo != "N/A" || tgInfo != undefined) {
          console.log("tgInfo==>", tgInfo);
          poolData.push({
            Name: poolAddress,
            TgInfo: tgInfo,
            Notes: "",
            CA: baseToken,
          });
        }
      }
    }
    await sleep(500);
  }
  return poolData;
};

const getLiquidity = async (chain, poolAddress) => {
  const url = `${ADDRESS}/pool/${chain}/${poolAddress}/liquidity`;
  const response = await makeRequest(url);
  // console.log("liquidity response ==>", response);
  if (response) return response.liquidity;
};

const getSocialInfo = async (chain, tokenAddress) => {
  const url = `${ADDRESS}/token/${chain}/${tokenAddress}`;
  const data = await makeRequest(url);
  if (data) return data.socialInfo?.telegram || "N/A";
};

const getDSinfo = async (tokenAddress) => {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {},
  });
  const data = await response.json();
  if (data) {
    const pairArray = data.pairs;
    if (pairArray.length > 0) {
      for (pair of pairArray) {
        const socials = pair.info.social;
        if (socials.length > 0) {
          for (const social of socials) {
            if (social.platform === "telegram") {
              return social.handle; // Return the Telegram URL
            }
          }
        } else {
          console.log("no social info from dexscreener.");
        }
      }
    }
  } else {
    console.log("no data from dexscreener.");
  }
};

const getCGInfo = async (tokenAddress) => {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddresses}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {},
  });
  const data = await response.json();
};

export const getPools = async (startDate, endDate, chain, version, ctx) => {
  const blockChainParams = getBlockchainParams(chain, version);
  const { network, contractAddress, slug } = blockChainParams;
  // console.log(version);

  try {
    const allPools = await fetchPoolsBetweenDates(slug, startDate, endDate);
    // console.log("allPools data==>", allPools);
    const poolData = await extractTokenAddresses(allPools, version, chain);

    if (poolData.length > 0) {
      convertJsonToCsv(poolData, "valid_tokens.csv", ctx);
      // console.log("social info==>", socialInfos);
    } else {
      await ctx.reply("No More Valid Tokens to Process");
      console.log("No valid tokens found to process.");
    }
    await sleep(1000);
    await ctx.reply("Welcome to TokenFinder!", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "BSC", callback_data: "chain:bsc" },
            { text: "Polygon", callback_data: "chain:polygon" },
            { text: "Base", callback_data: "chain:base" },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Error during token processing:", error);
    await ctx.reply("An error occurred while processing tokens.");
  }
};
