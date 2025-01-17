import { lookupArchive } from "@subsquid/archive-registry";
import { Store, TypeormDatabase } from "@subsquid/typeorm-store";
import {
  BatchContext,
  EvmLogEvent,
  SubstrateBatchProcessor,
  SubstrateBlock,
} from "@subsquid/substrate-processor";
import { CHAIN_NODE, contract, createContractEntity } from "./contract";
import * as erc721 from "./abi/erc721";
import * as rmrk from "./abi/rmrk";
import * as kanaria from "./abi/kanaria";
import { Owner, Purchase, Plot } from "./model";

const database = new TypeormDatabase();
const processor = new SubstrateBatchProcessor()
  .setBatchSize(100)
  .setDataSource({
    chain: CHAIN_NODE,
    archive: lookupArchive("moonriver", { release: "FireSquid" }),
  })
  .setTypesBundle("moonriver")
  .addEvmLog(contract.address, {
    filter: [
      kanaria.events["PlotsBought(uint256[],address,address,bool)"].topic,
    ],
  });
// .addEvmLog(/* secondContractAdress */, {
//   filter: [
//     abi.events["Your event name"].topic,
//   ],
// })

processor.run(database, async (ctx) => {
  for (const block of ctx.blocks) {
    if (block.header.height === 0) await ctx.store.save(createContractEntity());

    for (const item of block.items) {
      if (item.name === "EVM.Log") {
        if (item.event.args.address === contract.address) {
          if (
            item.event.args.topics[0] ===
            kanaria.events["PlotsBought(uint256[],address,address,bool)"].topic
          ) {
            await contractLogsHandler(ctx, block.header, item.event);
          }
        }
        // else if (contractAddress === secondContractAdress) {

        // }
      }
    }
  }
});

export async function contractLogsHandler(
  ctx: BatchContext<Store, unknown>,
  block: SubstrateBlock,
  event: EvmLogEvent
): Promise<void> {
  const bought = kanaria.events[
    "PlotsBought(uint256[],address,address,bool)"
  ].decode(event.args);
  const { plotIds, boughtWithCredits } = bought;

  let buyer = await ctx.store.get(Owner, bought.buyer);
  if (buyer == null) {
    buyer = new Owner({ id: bought.buyer, ownedPlots: [] });
    await ctx.store.save(buyer);
  }

  let referrer = await ctx.store.get(Owner, bought.referrer);
  if (referrer == null) {
    referrer = new Owner({ id: bought.referrer, ownedPlots: [] });
    await ctx.store.save(referrer);
  }

  for (const plotId of plotIds) {
    let plot = await ctx.store.get(Plot, plotId.toString());
    if (plot == null) {
      plot = new Plot({ id: plotId.toString(), owner: buyer });
      await ctx.store.save(plot);
    }

    let purchase = await ctx.store.get(
      Purchase,
      `${event.evmTxHash}_${plotId.toString()}`
    );
    if (purchase == null) {
      purchase = new Purchase({
        id: `${event.evmTxHash}_${plotId.toString()}`,
        plot,
        buyer,
        referrer,
        boughtWithCredits,
        timestamp: BigInt(block.timestamp),
        block: block.height,
        transactionHash: event.evmTxHash,
      });
      await ctx.store.save(purchase);
    }
  }
}
