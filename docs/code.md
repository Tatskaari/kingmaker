# Code structure

This game was built as a prototype. We want to productionize it. 

The goals here are 3 fold: 
1. Build something that is ready for multi-player and hosting on something like firebase down the line
2. Build something that allows us to test new ideas (evals), or use DI for unit/integration level testing
3. Build something with single responsibilities in each abstraction, that's easy to extend 

To achieve this:
1. Create a clear split between client, shared, and server code. We want clients to optimistically calculate things, while the server is authorative. World state updates should happen through this client/server interface. This interface is probably going to be very similar to the QA interface you built. We should also have the GM running server side, that uses a similar interface to interact with the game state (although will have RPCs the normal clients don't have). Conversation messages are game state, and anything else we need to show client side, but the docs service, transcripts of the agents etc. can be part of the AI side. 
2. Package these as different JS bundles. We still run the game in browser in a single page. Something sits on top, starts the server, then points the client to it (probably over a an in processes analogue to a socket, with some abstraction so we can DI this and replace it with the   
3. Use dependency injection (don't need a framework). The service + strategies were a good example of this, but we probably want even lower level like "docs store", and "game state store".  
4. I think the world should use ECS inspired (or just ECS) setups. Game objects can be nested into graphs. These can be copied into scenes. Spells can find flamable entities through the ECS rather than direct code dependency. 
5. Prefer composability over inheratance. The ECS will get you a long way there. 
5. The construction of the game should be done via config owned by each thing being constructed, that is brought together into a big .json file:


I don't write JS so good so here's a go example:
```
type Config struct {
   Client client.Config
   Shared shared.Config
   Server server.Config
}
```


Code style:


Packages should try and be single responsibility with no leaky abstractions. Achieve this through dependency injection + the ECS system. It may be worth investigating a mature ECS that provides some building blocks for this. Note: we don't want abstractions for the sake of abstractions either. This about creating a handful of clear top level services, then think about what they need to store, and how they interact. We want to be able to swap these out to try new strategies, or test things. 

Once we have that in place, we're optimising for readability in review. We want code to be easy to follow. Exported or entrypoint functions should be flat, with clear steps to them. In general, don't want nested if statement, or while loops at the top level. Call out to sub-functions at each stop. I should be able to understand from this what the general shape of the package does. 


This is true for the entry-point that does all the DI:

```
func runGame(config config.Config) error {
    services, err := newServices(config)
    ...
    
    server := newServer(config, services)
    
    serverClient := newLocalServerCleint(server)
    
    client := newClient(config, services, serverCleint)
    ...
    
    ...
    return client.Run()
}

// Move this out to it's own function so runGame stays clean and easy to understand the logical steps. 
func newServices(config) (..., error) {
    
    services := ...
    if config.Docs.Firebase != nil {
        services.add(docs.NewFirebaseStore(config.Docs.Firebase))
    }
    ...

}
```

Hooks are like RPCs and should follow a similar pattern

```

func (gm *GM) RespondToPlayer(conversation Conversation) ... {
    jevResult, err := gm.runJev()
    ...
    
    
    msgs, err := gm.ProgressiveDisclosure(jevResult)
    ...
    
    if jevResult.shouldRemember() {
        gm.remember(jevResult, conversion) // fires off the background character memory 
    }
    
    ...
    
    if jevResult.shouldRespondNow() {
        return gm.RespondInCharacter()
    }
}

```

The nested logic and details is pushed into these helper functions, so I can see at a glance what the strategy for handling a conversation turn is. Use this pattern for almost all exported functions in a package, as well as key internal functions that do orchestration. Try to break code up with a bit of whitespace too. 

We should also follow the guidance here: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

You could also try some of the es-lint rules to guide you, though I don't believe in adding this sort of thing to CI:
rules: {
  "max-depth": ["warn", 2],
  "max-nested-callbacks": ["warn", 2],
  "complexity": ["warn", 10],
  "sonarjs/cognitive-complexity": ["warn", 12],
}

